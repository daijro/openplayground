// Downloads each tool's web build (see tools.yaml) into public/<slug>/.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parse } from 'yaml'

const tools = parse(readFileSync('tools.yaml', 'utf8')).groups.flatMap((g) => g.tools)
const headers = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}
// Cargo build leftovers and precompressed copies some archives ship with; _headers/.htaccess only work at the site root.
const JUNK = /^(build|deps|incremental|examples|\.fingerprint|\.cargo-.*|_headers|\.htaccess|.*\.(gz|br))$/
const MAX_FILE = 25 * 1024 * 1024 // the host's per-file limit
const prelude = readFileSync('scripts/page-prelude.js', 'utf8')

// Brand and patch an installed build in `dir`. Idempotent, so it also runs on builds already installed and
// picks up tools.yaml, theme and prelude edits without a re-download.
const patch = (t, dir) => {
  // The dashboard's name as the tab title and its icon as the favicon.
  const icon = `site-icon${extname(t.icon)}`
  cpSync(t.icon, join(dir, icon))
  // Unzipped size of each .wasm, for the progress bar: a gzip file ends with it (mod 2^32).
  const wasm = {}
  for (const f of readdirSync(dir, { recursive: true })) {
    if (f.endsWith('.wasm.gz')) wasm[basename(f, '.gz')] = readFileSync(join(dir, f)).readUInt32LE(statSync(join(dir, f)).size - 4)
  }
  // The injected script: the prelude, then the tool's theme script (tools.yaml `theme:`), sharing `tool`.
  const { tag } = JSON.parse(readFileSync(join(dir, '.release'), 'utf8'))
  const script = [
    `const tool = ${JSON.stringify({ name: t.name, accent: t.accent, tag, wasm })}\n`,
    prelude,
    t.theme && readFileSync(t.theme, 'utf8'),
  ].filter(Boolean).join('\n')
  const page = join(dir, 'index.html')
  const html = readFileSync(page, 'utf8')
    .replace(/\s*<link rel="icon"[^>]*>/g, '')
    .replace(/<title>.*?<\/title>/, `<title>${t.name}</title>\n  <link rel="icon" href="${icon}">`)
    // The preload would fetch the raw .wasm, which is now .wasm.gz.
    .replace(/<link rel="preload" href="[^"]*\.wasm"[^>]*>/g, '')
    .replace(/\s*<script id="playground-prelude">[\s\S]*?<\/script>/, '')
    .replace(/<meta charset[^>]*>/i, (m) => `${m}\n  <script id="playground-prelude">{\n${script}}</script>`)
  writeFileSync(page, html)

  // EffectCraft's service worker precaches the .wasm by name and serves its cached index.html first: point
  // it at the .wasm.gz, and tie its VERSION to the patched page so returning visitors pick up changes.
  const sw = join(dir, 'sw.js')
  if (existsSync(sw)) {
    const hash = createHash('sha256').update(html).digest('hex').slice(0, 8)
    const code = readFileSync(sw, 'utf8')
      .replaceAll('.wasm"', '.wasm.gz"')
      .replace(/(const VERSION = "[^"-]+)(-[0-9a-f]+)?"/, `$1-${hash}"`)
    writeFileSync(sw, code)
  }
}

for (const t of tools) {
  try {
    const dir = join('public', t.slug)
    const pattern = new RegExp(t.asset ?? '-web-.*\\.zip$')
    const res = await fetch(`https://api.github.com/repos/${t.repo}/releases?per_page=100`, { headers })
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
    // Newest release (or the pinned tag) that actually has a web build.
    const release = (await res.json())
      .filter((r) => (t.tag ? r.tag_name === t.tag : !r.draft && !r.prerelease))
      .sort((a, b) => b.published_at.localeCompare(a.published_at))
      .find((r) => r.assets.some((a) => pattern.test(a.name)))
    if (!release) throw new Error(`no ${t.tag ? `release ${t.tag}` : 'release'} has an asset matching ${pattern}`)
    const asset = release.assets.find((a) => pattern.test(a.name))

    const stamp = JSON.stringify({ tag: release.tag_name, asset: asset.name, updated_at: asset.updated_at }) + '\n'
    if (existsSync(join(dir, '.release')) && readFileSync(join(dir, '.release'), 'utf8') === stamp) {
      console.log(`${t.slug}: ${asset.name} already installed`)
      patch(t, dir)
    } else {
      console.log(`${t.slug}: downloading ${asset.name} (${(asset.size / 1e6).toFixed(0)} MB)`)
      const tmp = mkdtempSync(join(tmpdir(), 'playground-'))
      try {
        const zip = await fetch(asset.browser_download_url)
        if (!zip.ok) throw new Error(`download ${zip.status}`)
        writeFileSync(join(tmp, 'build.zip'), Buffer.from(await zip.arrayBuffer()))
        execFileSync('unzip', ['-q', join(tmp, 'build.zip'), '-d', join(tmp, 'x')])
        // Archives hold one top-level folder (name-web-x.y.z/); use it if present.
        let root = join(tmp, 'x')
        const top = readdirSync(root, { withFileTypes: true })
        if (top.length === 1 && top[0].isDirectory()) root = join(root, top[0].name)
        if (!existsSync(join(root, 'index.html'))) throw new Error(`${asset.name} has no index.html`)

        // Prepare the finished build in tmp, then sync it in below.
        const next = join(tmp, 'next')
        for (const f of readdirSync(root)) if (!JUNK.test(f)) cpSync(join(root, f), join(next, f), { recursive: true })
        // Gzip the .wasm files to fit MAX_FILE; page-prelude.js unzips them in the browser.
        for (const f of readdirSync(next, { recursive: true })) {
          if (!f.endsWith('.wasm')) continue
          writeFileSync(join(next, `${f}.gz`), gzipSync(readFileSync(join(next, f)), { level: 9 }))
          rmSync(join(next, f))
        }
        writeFileSync(join(next, '.release'), stamp)
        patch(t, next)

        // Overwrite in place and delete only what's gone: deleting and re-adding the same path races in
        // Vite's dev server, which then 404s the file until restarted.
        mkdirSync(dir, { recursive: true })
        const keep = new Set(readdirSync(next, { recursive: true }))
        for (const f of readdirSync(dir, { recursive: true })) if (!keep.has(f)) rmSync(join(dir, f), { recursive: true, force: true })
        cpSync(next, dir, { recursive: true })
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    }

    for (const f of readdirSync(dir, { recursive: true })) {
      if (statSync(join(dir, f)).size > MAX_FILE) console.warn(`${t.slug}: ${f} is over 25 MiB, the host will reject it`)
    }
  } catch (e) {
    console.error(`${t.slug}: ${e.message}`)
    process.exitCode = 1
  }
}

// The installed release of each tool. The scheduled workflow commits this when it changes, and that push
// is what makes Cloudflare rebuild and redeploy the site.
const versions = {}
for (const t of tools) {
  const stamp = join('public', t.slug, '.release')
  if (existsSync(stamp)) versions[t.slug] = JSON.parse(readFileSync(stamp, 'utf8')).tag
}
writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n')

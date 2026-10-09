// Downloads each tool's web builds (see tools.yaml) on both channels (releases.mjs): its newest release into
// public/<slug>/, our build (scripts/build.mjs) when there is one, else the upstream release; and its newest
// commit into public/head/<slug>/, our build of it, else our newest earlier one. Each app's community plug-ins
// (store.yml) go into its plugins/ folder on both channels.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { CHANNELS, JUNK, builtAssets, channelAssets, github, installDir, resolveVersion, tools } from './releases.mjs'

const MAX_FILE = 25 * 1024 * 1024 // the host's per-file limit
const prelude = readFileSync('scripts/page-prelude.js', 'utf8')
const lazyPipelines = readFileSync('scripts/lazy-pipelines.js', 'utf8')
const WORKER_START = '// playground: lazy-pipelines.js {', WORKER_END = '// } playground'

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
  // Our builds of tools whose patches set the theme in the app itself (they follow prefers-color-scheme) skip it.
  const { tag, built } = JSON.parse(readFileSync(join(dir, '.release'), 'utf8'))
  const script = [
    `const tool = ${JSON.stringify({ name: t.name, accent: t.accent, tag, wasm })}\n`,
    prelude,
    lazyPipelines,
    t.theme && !(built && t.patches && readFileSync(t.patches, 'utf8').includes('prefers-color-scheme')) && readFileSync(t.theme, 'utf8'),
  ].filter(Boolean).join('\n')
  const page = join(dir, 'index.html')
  const html = readFileSync(page, 'utf8')
    .replace(/\s*<link rel="icon"[^>]*>/g, '')
    .replace(/<title>.*?<\/title>/, `<title>${t.name}</title>\n  <link rel="icon" href="${icon}">`)
    // The preload would fetch the raw .wasm, which is now .wasm.gz.
    .replace(/<link rel="preload" href="[^"]*\.wasm"[^>]*>/g, '')
    .replace(/\s*<script id="playground-prelude">[\s\S]*?<\/script>/, '')
    .replace(/\s*<link rel="stylesheet" href="\/shell\/shell\.css">/g, '')
    .replace(/\s*<script type="module" src="\/shell\/app\.js"><\/script>/g, '')
    // The prelude, then the shell (top bar, browser file storage: shell/), first in <head>, so
    // playgroundFiles exists before the app's own scripts start it.
    .replace(
      /<meta charset[^>]*>/i,
      (m) => `${m}\n  <script id="playground-prelude">{\n${script}}</script>\n  <link rel="stylesheet" href="/shell/shell.css">\n  <script type="module" src="/shell/app.js"></script>`,
    )
  writeFileSync(page, html)

  // Workers that run the app (EffectCraft renders frames in some) get lazy-pipelines.js too.
  for (const f of readdirSync(dir, { recursive: true }).filter((f) => basename(f) === 'worker.js')) {
    const code = readFileSync(join(dir, f), 'utf8')
    const original = code.startsWith(WORKER_START) ? code.slice(code.indexOf(WORKER_END) + WORKER_END.length + 1) : code
    writeFileSync(join(dir, f), `${WORKER_START}\n${lazyPipelines}${WORKER_END}\n${original}`)
  }

  // EffectCraft's service worker precaches the .wasm by name and serves its cached index.html first: point
  // it at the .wasm.gz, and tie its VERSION to the patched page and to everything in shell/ (the worker
  // serves /shell/* cache-first too), so returning visitors pick up changes.
  const sw = join(dir, 'sw.js')
  if (existsSync(sw)) {
    const hash = createHash('sha256').update(html)
    for (const f of readdirSync('shell').sort()) hash.update(readFileSync(join('shell', f)))
    const version = hash.digest('hex').slice(0, 8)
    const code = readFileSync(sw, 'utf8')
      .replaceAll('.wasm"', '.wasm.gz"')
      .replace(/(const VERSION = "[^"-]+)(-[0-9a-f]+)?"/, `$1-${version}"`)
    writeFileSync(sw, code)
  }

  // The app's community plug-ins (`store`, below; tools.yaml repo storytold/photocraft takes the store's
  // `app: photocraft`) in plugins/, with an index.json listing them, which its patches load. Replaced in
  // place (see install) so one gone from the store goes here too; without a store build they stay as they are.
  if (store) {
    const plugins = join(dir, 'plugins')
    const mine = store.index.filter((p) => p.app === t.repo.split('/')[1])
    if (!mine.length) return rmSync(plugins, { recursive: true, force: true })
    mkdirSync(plugins, { recursive: true })
    for (const p of mine) cpSync(join(store.dir, p.file), join(plugins, p.file))
    writeFileSync(join(plugins, 'index.json'), JSON.stringify(mine, null, 2) + '\n')
    const keep = new Set(['index.json', ...mine.map((p) => p.file)])
    for (const f of readdirSync(plugins)) if (!keep.has(f)) rmSync(join(plugins, f), { recursive: true, force: true })
  }
}

// A zip asset into `file`: a release asset, or a local one ({path}).
const download = async (asset, file) => {
  if (asset.path) return cpSync(asset.path, file)
  const zip = await fetch(asset.browser_download_url)
  if (!zip.ok) throw new Error(`download ${zip.status}`)
  writeFileSync(file, Buffer.from(await zip.arrayBuffer()))
}

let built = await builtAssets()

// The ArtCraft Store's plug-ins (.github/workflows/store.yml): the newest artcraft-store-<commit>.zip of the
// builds release, its .wasm files and an index.json [{id, name, version, author, description, kind, app,
// file}], unpacked once for patch(). A local out/artcraft-store-*.zip wins, to try one before CI publishes
// it. None, or a failed download: every app keeps the plug-ins it has.
const STORE = /^artcraft-store-([0-9a-f]+)\.zip$/
const store = await (async () => {
  const out = (f) => join('out', f)
  const local = existsSync('out') && readdirSync('out').filter((f) => STORE.test(f)).sort((a, b) => statSync(out(b)).mtimeMs - statSync(out(a)).mtimeMs)[0]
  const asset = local ? { name: local, path: out(local) } : built.filter((a) => STORE.test(a.name)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  if (!asset) return console.log('plug-ins: no artcraft-store build yet')
  const tmp = mkdtempSync(join(tmpdir(), 'playground-store-'))
  process.on('exit', () => rmSync(tmp, { recursive: true, force: true }))
  await download(asset, join(tmp, 'store.zip'))
  const dir = join(tmp, 'x')
  execFileSync('unzip', ['-q', join(tmp, 'store.zip'), '-d', dir])
  // Only plainly named .wasm files that are there: the files come out of the store's build.
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).filter(
    (p) => /^\w[\w.-]*\.wasm$/.test(p.file) && lstatSync(join(dir, p.file), { throwIfNoEntry: false })?.isFile(),
  )
  console.log(`plug-ins: ${asset.name}: ${index.map((p) => `${p.name} (${p.app})`).join(', ') || 'none'}`)
  return { dir, index, version: asset.name.match(STORE)[1] }
})().catch((e) => console.error(`plug-ins: ${e.message}; every app keeps the plug-ins it has`))

// Each tool's versions, looked up once: the head channel also needs the release, to count commits ahead.
const versions = new Map()
const version = (t, channel) => versions.get(`${t.slug} ${channel}`) ?? versions.set(`${t.slug} ${channel}`, resolveVersion(t, channel)).get(`${t.slug} ${channel}`)
for (const t of tools) {
  for (const channel of CHANNELS) {
    const name = channel === 'head' ? `${t.slug}@head` : t.slug
    try {
      // A build replaced (and deleted) between listing and downloading it: list again and take its successor.
      await install(t, channel, name).catch(async (e) => {
        if (!/download 404/.test(e.message)) throw e
        built = await builtAssets()
        await install(t, channel, name)
      })
    } catch (e) {
      console.error(`${name}: ${e.message}`)
      process.exitCode = 1
    }
  }
}

async function install(t, channel, name) {
  const dir = installDir(t, channel)
  const current = await version(t, channel)
  if (!current) {
    rmSync(dir, { recursive: true, force: true }) // a channel the tool no longer has
    return console.log(`${name}: no ${channel} version`)
  }
  const { release, asset: upstream } = current
  // Our builds of this tool on this channel, newest first, and the newest of this version.
  const builds = channelAssets(built, t, channel)
  const ours = builds.find((a) => a.name.startsWith(`${t.slug}-${release.tag_name}-`))
  // A build made here with build.mjs (out/<slug>-<tag>-<hash>.zip) wins, to try builds before CI publishes them.
  const localZip = existsSync('out') && readdirSync('out').filter((f) => f.startsWith(`${t.slug}-${release.tag_name}-`) && f.endsWith('.zip')).sort().at(-1)
  const local = localZip && { name: localZip, path: join('out', localZip), updated_at: statSync(join('out', localZip)).mtime.toISOString(), size: statSync(join('out', localZip)).size }
  // The head channel has no upstream zip: until its newest commit is built, keep its newest earlier build;
  // one never built is left out (the dashboard doesn't list it).
  const previous = !upstream && !ours && builds[0]
  const asset = local || ours || upstream || previous
  if (!asset) return console.warn(`${name}: ${release.tag_name} isn't built yet and there's no earlier build: skipped`)
  let { tag_name: tag, label, date } = release
  if (asset === previous) {
    tag = asset.name.slice(t.slug.length + 1, asset.name.lastIndexOf('-'))
    const commit = tag.replace(/^head-/, '')
    date = (await github(`repos/${t.repo}/commits/${commit}`)).commit.committer.date
    label = `${t.branch ?? 'main'}@${commit}`
    console.log(`${name}: ${release.tag_name} isn't built yet, keeping ${tag}`)
  }

  // How far a head build is past the tool's newest release, for the dashboard's tooltip.
  let ahead
  const latest = channel === 'head' && (await version(t, 'release'))
  if (latest) {
    const compare = await github(`repos/${t.repo}/compare/${latest.release.tag_name}...${tag.replace(/^head-/, '')}`)
    ahead = { commits: compare.ahead_by, of: latest.release.tag_name }
  }

  const stamp = JSON.stringify({ tag, label: label ?? tag, date, ahead, asset: asset.name, updated_at: asset.updated_at, built: !!(local || ours || previous) }) + '\n'
  if (existsSync(join(dir, '.release')) && readFileSync(join(dir, '.release'), 'utf8') === stamp) {
    console.log(`${name}: ${asset.name} already installed`)
    patch(t, dir)
  } else {
    console.log(`${name}: downloading ${asset.name} (${(asset.size / 1e6).toFixed(0)} MB)`)
    const tmp = mkdtempSync(join(tmpdir(), 'playground-'))
    try {
      await download(asset, join(tmp, 'build.zip'))
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
    if (statSync(join(dir, f)).size > MAX_FILE) console.warn(`${name}: ${f} is over 25 MiB, the host will reject it`)
  }
}

// The installed version of each tool on each channel (<slug>, <slug>@head), with +<hash> for our builds. The
// scheduled workflow commits this when it changes, and that push is what makes Cloudflare redeploy the site.
const installedVersions = {}
for (const t of tools) {
  for (const channel of CHANNELS) {
    const stamp = join(installDir(t, channel), '.release')
    if (!existsSync(stamp)) continue
    const { tag, asset, built } = JSON.parse(readFileSync(stamp, 'utf8'))
    installedVersions[channel === 'head' ? `${t.slug}@head` : t.slug] = built ? `${tag}+${asset.match(/-([0-9a-f]{8})\.zip$/)[1]}` : tag
  }
}
// The store build the plug-ins come from (kept while there's none to install), so a new one ships too.
installedVersions['artcraft-store'] = store?.version ?? (existsSync('versions.json') ? JSON.parse(readFileSync('versions.json', 'utf8'))['artcraft-store'] : undefined)
writeFileSync('versions.json', JSON.stringify(installedVersions, null, 2) + '\n')

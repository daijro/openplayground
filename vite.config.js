import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { defineConfig } from 'vite'
import { parse } from 'yaml'
import { diffDir } from './scripts/diffs.mjs'
import { BUILDS, COMMIT_FILE, alternativeIcon, appSlug, installDir } from './scripts/releases.mjs'

// A restored download cache can still contain apps removed from tools.yaml.
export function pruneRetiredBuilds(root = 'public') {
  const names = new Set(parse(readFileSync('tools.yaml', 'utf8')).groups.flatMap((g) => g.tools).map(appSlug))
  for (const base of [root, join(root, 'head')]) {
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const dir = join(base, entry.name)
      if (entry.isDirectory() && !names.has(entry.name) && existsSync(join(dir, '.release'))) rmSync(dir, { recursive: true })
    }
  }
}

// What `make fetch` installed of a tool on a channel (its .release stamp, and our build's Playground commit), and where
// it's served.
const installed = (t, channel) => {
  const path = `${installDir(t, channel).slice('public'.length)}/`
  const commit = `public${path}${COMMIT_FILE}`
  try {
    return { path, ...JSON.parse(readFileSync(`public${path}.release`, 'utf8')), commit: existsSync(commit) ? readFileSync(commit, 'utf8').trim() : null }
  } catch {}
}

// The bar's Source menu (shell/topbar.js): the app's code at the version this build is of, its licence there (tools.yaml
// `license`), and for our builds the patch files that made it, at the Playground commit that built it (fetch.mjs).
// ponytail: a build with no commit on record (kept from before build.yml recorded them, while its patches have changed
// since) links them on main; it goes once that app is rebuilt.
const source = (t, s) => {
  if (!s.tag) return null // a hand-made stand-in for a build
  const ref = s.tag.replace(/^head-/, '')
  const ids = t.license?.split(' OR ') ?? []
  const at = s.commit ?? 'main'
  return {
    repo: t.repo, ref, url: `https://github.com/${t.repo}/tree/${ref}`, license: t.license ?? null, commit: s.commit ?? null,
    licenses: ids.map((id) => {
      const file = ids.length > 1 ? `LICENSE-${id.split('-')[0].toUpperCase()}` : (t.license_file ?? 'LICENSE')
      return { id, file, url: `https://github.com/${t.repo}/blob/${ref}/${file}` }
    }),
    patches: !s.built ? [] : [t.patches, diffDir(t) && `${diffDir(t)}/`, t.live && 'patches/live/playground_live.rs'].filter(Boolean).map((path) => ({
      path, url: `https://github.com/${BUILDS.repo}/${path.endsWith('/') ? 'tree' : 'blob'}/${at}/${path.replace(/\/$/, '')}`,
    })),
  }
}

// GitHub's mark (Octicons mark-github), linking each card to its repo.
const GITHUB = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>'

// A card links to the release, and carries the latest-commit build's link, label and commit date for the
// channel switch (index.html). A tool missing one channel uses the other for both.
// Each alternative icon's glitch starts at its own point in the loop, so the cards don't flicker in step.
const glitchDelay = (t) => -([...t.slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % 40) / 10

export const card = (t) => {
  const repo = t.repo.split('/')[1]
  const release = installed(t, 'release')
  const head = installed(t, 'head') ?? release
  const shown = release ?? head
  const ahead = head.ahead ? `${head.ahead.commits} commit${head.ahead.commits === 1 ? '' : 's'} ahead of ${head.ahead.of}` : ''
  // Both names and icons: the app's own, and the one it's an alternative to (index.html's "Alternative naming").
  const altIcon = alternativeIcon(t) && `/${alternativeIcon(t)}`
  const own = t.alternative ? ' class="as-own"' : ''
  return `
      <div class="tool" data-release-href="${shown.path}" data-head-href="${head.path}" style="--accent:${t.accent};--base:${t.base}">
        <img${t.alternative && altIcon ? own : ''} src="/${t.icon}" alt="" width="64" height="64">${t.alternative && altIcon ? `
        <span class="as-alt glitch" style="--icon:url('${altIcon}');--glitch-delay:${glitchDelay(t)}s"><img src="${altIcon}" alt="" width="64" height="64"></span>` : ''}
        <span class="title">
          <a class="name open" href="${shown.path}"><span${own}>${t.name}</span>${t.alternative ? `<span class="as-alt">${t.alternative}</span>` : ''}</a>
          <span class="source"><a class="repo" href="https://github.com/${t.repo}" aria-label="${repo} on GitHub" title="${t.repo} on GitHub">${GITHUB}</a> <span class="version" data-release="${shown.label}" data-head="${head.label}" data-date="${head.date ?? ''}" data-ahead="${ahead}">${shown.label}</span></span>
        </span>
        ${t.alternative ? `<span class="alt as-own">${altIcon ? `<span class="glitch small" style="--icon:url('${altIcon}');--glitch-delay:${glitchDelay(t)}s"><img src="${altIcon}" alt="" width="14" height="14"></span>` : ''}Alternative to ${t.alternative}</span>
        <span class="alt as-alt"><img src="/${t.icon}" alt="" width="14" height="14">Using ${t.name}</span>` : ''}
      </div>`
}

const group = (g) => `
    <section>
      <h2>${g.alternative ? `<span class="as-own">${g.name}</span><span class="as-alt">${g.alternative}</span>` : g.name}</h2>
      <div class="tools">${g.tools.map(card).join('')}
      </div>
    </section>`

// Read per request, so tools.yaml edits and `make fetch` show up on refresh. Only installed tools are
// listed (one whose first build isn't ready yet has nothing to open).
const renderGroups = () =>
  parse(readFileSync('tools.yaml', 'utf8'))
    .groups.map((g) => ({ ...g, tools: g.tools.filter((t) => installed(t, 'release') || installed(t, 'head')) }))
    .filter((g) => g.tools.length)
    .map(group)
    .join('')

// /shell/apps.json: what the shell's app switcher and file explorer list, from tools.yaml and the installed
// builds (the same stamps the dashboard reads). An app's icon is its install's site-icon (fetch.mjs copies it).
const appsJson = () => ({
  groups: parse(readFileSync('tools.yaml', 'utf8'))
    .groups.map((g) => ({
      name: g.name,
      alternative: g.alternative ?? null,
      apps: g.tools.flatMap((t) => {
        const release = installed(t, 'release')
        const head = installed(t, 'head')
        if (!release && !head) return []
        // built: when our build was made (its asset's date), for the License notice's "modified" date.
        const channel = (s) => s && { path: s.path, label: s.label, date: s.date ?? null, built: s.built ? (s.updated_at ?? null) : null, source: source(t, s) }
        return [{
          slug: t.slug, name: t.name, alternative: t.alternative ?? null, blurb: t.blurb, accent: t.accent, opens: t.opens ?? [], imports: t.imports ?? [], notice: t.notice ?? null,
          repo: t.repo, isolated: !!t.isolated, license: t.license ?? null, copyright: [t.copyright ?? []].flat(),
          icon: `${(release ?? head).path}site-icon${extname(t.icon)}`,
          alternativeIcon: alternativeIcon(t) ? `${(release ?? head).path}alternative-icon${extname(alternativeIcon(t))}` : null,
          release: channel(release) ?? null, head: channel(head) ?? null,
        }]
      }),
    }))
    .filter((g) => g.apps.length),
})

// Old product names and unavailable channels follow the dashboard's available build.
export const appRedirects = (apps) => {
  const canonical = new Set(apps.map(appSlug))
  const redirects = {}
  for (const app of apps) {
    const own = appSlug(app)
    for (const alias of new Set([app.slug, own])) {
      if (alias !== own && canonical.has(alias)) continue
      for (const [prefix, build] of [['', app.release ?? app.head], ['/head', app.head ?? app.release]]) {
        const from = `${prefix}/${alias}`
        if (!build || `${from}/` === build.path) continue
        redirects[from] = redirects[`${from}/`] = build.path
        redirects[`${from}/*`] = `${build.path}:splat`
      }
    }
  }
  // Cloudflare counts every rule after the first wildcard toward its 100 dynamic-rule limit.
  return Object.fromEntries(Object.entries(redirects).sort(([a], [b]) => Number(a.endsWith('/*')) - Number(b.endsWith('/*'))))
}
const aliases = () => appRedirects(appsJson().groups.flatMap((group) => group.apps))
const isolatedPaths = () => parse(readFileSync('tools.yaml', 'utf8')).groups.flatMap((g) => g.tools)
  .filter((t) => t.isolated).flatMap((t) => ['release', 'head'].flatMap((c) => installed(t, c)?.path ?? []))
const isolationHeaders = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }

// Vite doesn't serve index.html for public/ folders: /slug -> /slug/ -> /slug/index.html, like a static host would.
const toolIndex = (req, res, next) => {
  const [path, query = ''] = req.url.split(/(?=\?)/)
  const redirects = aliases()
  const wildcard = Object.keys(redirects).find((from) => from.endsWith('/*') && path.startsWith(from.slice(0, -1)))
  const destination = redirects[path] ?? (wildcard && redirects[wildcard].replace(':splat', path.slice(wildcard.length - 1)))
  if (destination) return res.writeHead(302, { location: `${destination}${query}` }).end()
  if (isolatedPaths().some((prefix) => path.startsWith(prefix))) {
    for (const [name, value] of Object.entries(isolationHeaders)) res.setHeader(name, value)
  }
  if (path === '/' || !existsSync(`public${path.replace(/\/?$/, '/index.html')}`)) return next()
  if (!path.endsWith('/')) return res.writeHead(301, { location: `${path}/${query}` }).end()
  req.url = `${path}index.html${query}`
  next()
}

// What a standalone copy of an installed app holds (shell/standalone.js): every file of its folder but the stamps and
// the dashboard's alternative-icon, with sizes, listed at <app>/playground-manifest.json (made here, so installs made
// before it existed have one too).
export const MANIFEST = 'playground-manifest.json'
export const manifest = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !/(^|\/)\./.test(join(e.parentPath, e.name)) && !/^(alternative-icon\.[a-z]+|playground-manifest\.json)$/.test(e.name))
    .map((e) => ({ path: join(e.parentPath, e.name).slice(dir.length + 1), size: statSync(join(e.parentPath, e.name)).size }))
    .sort((a, b) => a.path.localeCompare(b.path))
const installedDirs = () =>
  parse(readFileSync('tools.yaml', 'utf8')).groups.flatMap((g) => g.tools).flatMap((t) => ['release', 'head'].flatMap((c) => installed(t, c)?.path ?? []))

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }
// The shell (top bar, file explorer, browser file storage: the shell/ folder) at /shell/, for the app pages
// and /files/. Served as-is, not through Vite's module pipeline, exactly as the built site serves it.
const shell = (req, res, next) => {
  const path = req.url.split('?')[0]
  const app = path.endsWith(`/${MANIFEST}`) && installedDirs().find((dir) => path === `${dir}${MANIFEST}`)
  if (app) {
    res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-cache' })
    return res.end(JSON.stringify(manifest(`public${app}`.replace(/\/$/, ''))))
  }
  if (!path.startsWith('/shell/')) return next()
  const name = path.slice('/shell/'.length)
  if (name === 'apps.json') {
    res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-cache' })
    return res.end(JSON.stringify(appsJson()))
  }
  const file = join('shell', name)
  if (name.includes('..') || !statSync(file, { throwIfNoEntry: false })?.isFile()) return next()
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
  res.end(readFileSync(file))
}

export default defineConfig({
  appType: 'mpa',
  // Worktrees and their app builds live in .claude/; changes there shouldn't reload the pages open here.
  server: {
    watch: { ignored: ['**/.claude/**'] },
    proxy: process.env.SESSION_API ? { '/api/session/': { target: process.env.SESSION_API, ws: true } } : undefined,
  },
  build: { rollupOptions: { input: { main: 'index.html', files: 'files/index.html' } } },
  plugins: [
    {
      name: 'tools',
      configResolved: () => pruneRetiredBuilds(),
      transformIndexHtml: { order: 'pre', handler: (html) => html.replace('<!-- groups -->', renderGroups()) },
      configureServer: (server) => {
        server.middlewares.use(shell)
        server.middlewares.use(toolIndex)
      },
      configurePreviewServer: (server) => void server.middlewares.use(toolIndex),
    },
    {
      // The built site serves the shell as plain files, like the dev middleware above.
      name: 'shell',
      apply: 'build',
      closeBundle() {
        cpSync('shell', 'dist/shell', { recursive: true })
        for (const dir of installedDirs()) writeFileSync(`dist${dir}${MANIFEST}`, JSON.stringify(manifest(`public${dir}`.replace(/\/$/, ''))))
        writeFileSync('dist/shell/apps.json', JSON.stringify(appsJson()))
        writeFileSync('dist/_headers', isolatedPaths().map((path) => `${path}*\n${Object.entries(isolationHeaders).map(([name, value]) => `  ${name}: ${value}`).join('\n')}`).join('\n') + '\n')
        writeFileSync('dist/_redirects', Object.entries(aliases()).map(([from, to]) => `${from} ${to} 302`).join('\n') + '\n')
      },
    },
  ],
})

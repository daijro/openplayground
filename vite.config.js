import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { defineConfig } from 'vite'
import { parse } from 'yaml'

// What `make fetch` installed of a tool on a channel (its .release stamp), and where it's served.
const installed = (t, channel) => {
  const path = channel === 'head' ? `/head/${t.slug}/` : `/${t.slug}/`
  try {
    return { path, ...JSON.parse(readFileSync(`public${path}.release`, 'utf8')) }
  } catch {}
}

// A card links to the release, and carries the latest-commit build's link, label and commit date for the
// channel switch (index.html). A tool missing one channel uses the other for both.
const card = (t) => {
  const repo = t.repo.split('/')[1]
  const release = installed(t, 'release')
  const head = installed(t, 'head') ?? release
  const shown = release ?? head
  const ahead = head.ahead ? `${head.ahead.commits} commit${head.ahead.commits === 1 ? '' : 's'} ahead of ${head.ahead.of}` : ''
  return `
      <div class="tool" data-release-href="${shown.path}" data-head-href="${head.path}" style="--accent:${t.accent};--base:${t.base}">
        <img src="/${t.icon}" alt="" width="64" height="64">
        <span class="title">
          <a class="name open" href="${shown.path}">${t.name}</a>
          <span class="source"><a class="repo" href="https://github.com/${t.repo}">${repo}</a> <span class="version" data-release="${shown.label}" data-head="${head.label}" data-date="${head.date ?? ''}" data-ahead="${ahead}">${shown.label}</span></span>
        </span>
        <span class="blurb">${t.blurb}</span>
      </div>`
}

const group = (g) => `
    <section>
      <h2>${g.name}</h2>
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
      apps: g.tools.flatMap((t) => {
        const release = installed(t, 'release')
        const head = installed(t, 'head')
        if (!release && !head) return []
        const channel = (s) => s && { path: s.path, label: s.label, date: s.date ?? null }
        return [{
          slug: t.slug, name: t.name, blurb: t.blurb, accent: t.accent, opens: t.opens ?? [], imports: t.imports ?? [],
          icon: `${(release ?? head).path}site-icon${extname(t.icon)}`,
          release: channel(release) ?? null, head: channel(head) ?? null,
        }]
      }),
    }))
    .filter((g) => g.apps.length),
})

// Vite doesn't serve index.html for public/ folders: /slug -> /slug/ -> /slug/index.html, like a static host would.
const toolIndex = (req, res, next) => {
  const [path, query = ''] = req.url.split(/(?=\?)/)
  if (path === '/' || !existsSync(`public${path.replace(/\/?$/, '/index.html')}`)) return next()
  if (!path.endsWith('/')) return res.writeHead(301, { location: `${path}/${query}` }).end()
  req.url = `${path}index.html${query}`
  next()
}

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }
// The shell (top bar, file explorer, browser file storage: the shell/ folder) at /shell/, for the app pages
// and /files/. Served as-is, not through Vite's module pipeline, exactly as the built site serves it.
const shell = (req, res, next) => {
  const path = req.url.split('?')[0]
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
  build: { rollupOptions: { input: { main: 'index.html', files: 'files/index.html' } } },
  plugins: [
    {
      name: 'tools',
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
        writeFileSync('dist/shell/apps.json', JSON.stringify(appsJson()))
      },
    },
  ],
})

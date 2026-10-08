import { existsSync, readFileSync } from 'node:fs'
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
  return `
      <a class="tool" href="${shown.path}" data-release-href="${shown.path}" data-head-href="${head.path}" style="--accent:${t.accent};--base:${t.base}">
        <img src="/${t.icon}" alt="" width="64" height="64">
        <span class="title">
          <span class="name">${t.name}</span>
          <span class="source" data-release="${repo} ${shown.label}" data-head="${repo} ${head.label}" data-date="${head.date ?? ''}" data-ahead="${head.ahead ? `${head.ahead.commits} commit${head.ahead.commits === 1 ? '' : 's'} ahead of ${head.ahead.of}` : ''}">${repo} ${shown.label}</span>
        </span>
        <span class="blurb">${t.blurb}</span>
      </a>`
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

// Vite doesn't serve index.html for public/ folders: /slug -> /slug/ -> /slug/index.html, like a static host would.
const toolIndex = (req, res, next) => {
  const [path, query = ''] = req.url.split(/(?=\?)/)
  if (path === '/' || !existsSync(`public${path.replace(/\/?$/, '/index.html')}`)) return next()
  if (!path.endsWith('/')) return res.writeHead(301, { location: `${path}/${query}` }).end()
  req.url = `${path}index.html${query}`
  next()
}

export default defineConfig({
  appType: 'mpa',
  plugins: [
    {
      name: 'tools',
      transformIndexHtml: { order: 'pre', handler: (html) => html.replace('<!-- groups -->', renderGroups()) },
      configureServer: (server) => void server.middlewares.use(toolIndex),
      configurePreviewServer: (server) => void server.middlewares.use(toolIndex),
    },
  ],
})

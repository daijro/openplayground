import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { parse } from 'yaml'

// Release tag `make fetch` installed for a tool, if any.
const installedTag = (slug) => {
  try {
    return JSON.parse(readFileSync(`public/${slug}/.release`, 'utf8')).tag
  } catch {}
}

const card = (t) => `
      <a class="tool" href="/${t.slug}/" style="--accent:${t.accent};--base:${t.base}">
        <img src="/${t.icon}" alt="" width="64" height="64">
        <span class="title">
          <span class="name">${t.name}</span>
          <span class="source">${[t.repo.split('/')[1], installedTag(t.slug)].filter(Boolean).join(' ')}</span>
        </span>
        <span class="blurb">${t.blurb}</span>
      </a>`

const group = (g) => `
    <section>
      <h2>${g.name}</h2>
      <div class="tools">${g.tools.map(card).join('')}
      </div>
    </section>`

// Read per request, so tools.yaml edits and `make fetch` show up on refresh.
const renderGroups = () => parse(readFileSync('tools.yaml', 'utf8')).groups.map(group).join('')

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

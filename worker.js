import { sessionRequest } from './session-room.js'
export { SessionRoom } from './session-room.js'

// The site's Worker. Requests are served from the static assets (dist/); this script only runs for paths
// that aren't files, and every hour (wrangler.jsonc `triggers`), when it starts the GitHub
// workflows that pick up new releases. GitHub's own schedule for them can lag or not fire at all.
//
// Needs the GITHUB_TOKEN secret: a fine-grained token for daijro/openplayground with Actions: read and write.
const WORKFLOWS = ['build.yml', 'store.yml', 'fetch.yml']

// POST /api/clear-site-data?what=cache|all: the browser drops this site's HTTP cache (the downloaded apps; they download
// again on next open) or, for `all`, its storage too (Files, settings, sessions). Scripts can't empty the HTTP cache
// themselves; the Clear-Site-Data header can (shell/store.js clearSiteData).
const clearSiteData = (url) =>
  new Response(null, {
    status: 204,
    headers: { 'clear-site-data': url.searchParams.get('what') === 'all' ? '"cache", "storage"' : '"cache"', 'cache-control': 'no-store' },
  })

export default {
  fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/session/')) return sessionRequest(request, env)
    if (url.pathname === '/api/clear-site-data' && request.method === 'POST') return clearSiteData(url)
    return env.ASSETS.fetch(request)
  },

  async scheduled(event, env) {
    if (!env.GITHUB_TOKEN) return console.error('GITHUB_TOKEN secret is not set: not starting the workflows')
    for (const workflow of WORKFLOWS) {
      const res = await fetch(`https://api.github.com/repos/daijro/openplayground/actions/workflows/${workflow}/dispatches`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.GITHUB_TOKEN}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'openplayground-cron',
        },
        body: JSON.stringify({ ref: 'main' }),
      })
      if (!res.ok) console.error(`starting ${workflow}: GitHub ${res.status} ${await res.text()}`)
    }
  },
}

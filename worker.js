// The site's Worker. Requests are served from the static assets (dist/); this script only runs for paths
// that aren't files, and every 15 minutes (wrangler.jsonc `triggers`), when it starts the GitHub
// workflows that pick up new releases. GitHub's own schedule for them can lag or not fire at all.
//
// Needs the GITHUB_TOKEN secret: a fine-grained token for daijro/openplayground with Actions: read and write.
const WORKFLOWS = ['build.yml', 'store.yml', 'fetch.yml']

export default {
  fetch: (request, env) => env.ASSETS.fetch(request),

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

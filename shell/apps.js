// The site's apps, from /shell/apps.json (vite.config.js builds it from tools.yaml and the installed builds).

let data
/** { groups: [{ name, apps: [{ slug, name, blurb, accent, icon, opens, release, head }] }] } */
export const loadApps = () =>
  (data ??= fetch('/shell/apps.json')
    .then((r) => (r.ok ? r.json() : { groups: [] }))
    .catch(() => ({ groups: [] })))

export const flatApps = ({ groups }) => groups.flatMap((g) => g.apps)

/** The app page this is ('/word/' or '/head/word/'): { slug, channel }, or null on other pages. */
export const currentApp = (pathname = location.pathname) => {
  const m = pathname.match(/^\/(?:(head)\/)?([^/]+)\//)
  return m && !['files', 'shell'].includes(m[2]) ? { slug: m[2], channel: m[1] ? 'head' : 'release' } : null
}

// The dashboard's "Use latest commits" switch (index.html) keeps its choice in localStorage.channel.
const preferred = () => {
  try {
    return localStorage.getItem('channel')
  } catch {
    return null
  }
}
/** An app's page in the preferred channel, else the one it has. */
export const appHref = (app) => ((preferred() === 'head' && app.head) || app.release || app.head).path

// /files/: the explorer as a page. "Open in <app>" goes to the app with ?open=browser:/… (files.js opens it).
import { appHref, flatApps, loadApps } from './apps.js'
import { explorer } from './explorer.js'
import { toAppPath } from './paths.js'

export async function mountFilesPage(container) {
  const apps = flatApps(await loadApps())
  const view = explorer({
    mode: 'browse',
    apps,
    onOpenInApp: (path, app) => (location.href = `${appHref(app)}?open=${encodeURIComponent(toAppPath(path))}`),
  })
  container.append(view.el)
  await view.ready
  view.focus()
}

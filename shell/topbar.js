// The bar above every app: back to the dashboard, switch apps, this build's version, Files and fullscreen.
import { appHref, currentApp, loadApps } from './apps.js'
import { openFilesPopup } from './files.js'
import { h, icon, isolate } from './ui.js'

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS = [['year', 31536e3], ['month', 2592e3], ['week', 6048e2], ['day', 864e2], ['hour', 3600], ['minute', 60]]
const ago = (iso) => {
  const s = (Date.parse(iso) - Date.now()) / 1000
  const [unit, size] = UNITS.find(([, n]) => Math.abs(s) >= n) ?? ['minute', 60]
  return relative.format(Math.round(s / size), unit)
}

export async function mountTopbar() {
  const here = currentApp()
  const { groups } = await loadApps()
  const app = groups.flatMap((g) => g.apps).find((a) => a.slug === here?.slug)
  const build = app?.[here.channel]

  const menu = h(
    'div',
    { class: 'pg-apps', id: 'pg-apps', popover: 'auto', role: 'menu', 'aria-label': 'Apps' },
    groups.map((g) => [
      h('p', { class: 'pg-apps-group' }, g.name),
      g.apps.map((a) =>
        h(
          'a',
          { class: 'pg-app', role: 'menuitem', href: appHref(a), 'aria-current': a.slug === here?.slug ? 'page' : null },
          h('img', { src: a.icon, alt: '' }),
          h('span', {}, h('strong', {}, a.name), h('small', {}, a.blurb)),
          a.slug === here?.slug ? icon('check') : null,
        ),
      ),
    ]),
  )

  const fullscreen = h('button', { class: 'pg-bar-btn', type: 'button', 'aria-label': 'Fullscreen', title: 'Fullscreen' }, icon('expand'))
  fullscreen.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}))
  addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement
    fullscreen.replaceChildren(icon(on ? 'shrink' : 'expand'))
    fullscreen.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen')
    fullscreen.title = on ? 'Exit fullscreen' : 'Fullscreen'
  })

  const bar = isolate(
    h(
      'header',
      { class: 'pg-bar' },
      h('a', { class: 'pg-home', href: '/' }, h('span', { class: 'pg-mark', 'aria-hidden': 'true' }), h('span', { class: 'pg-label' }, 'Playground')),
      app ? h('button', { class: 'pg-switch', type: 'button', popovertarget: 'pg-apps', 'aria-haspopup': 'menu' }, h('img', { src: app.icon, alt: '' }), app.name, icon('chevron')) : null,
      build
        ? h(
            'span',
            { class: `pg-version${here.channel === 'head' ? ' pg-head' : ''}`, title: here.channel === 'head' ? 'Latest commit (unstable)' : 'Release' },
            build.label + (here.channel === 'head' && build.date ? ` · ${ago(build.date)}` : ''),
          )
        : null,
      h('span', { class: 'pg-spacer' }),
      h('button', { class: 'pg-bar-btn', type: 'button', onclick: () => openFilesPopup() }, icon('files'), h('span', { class: 'pg-label' }, 'Files')),
      fullscreen,
      menu,
    ),
  )
  document.body.prepend(bar)
}

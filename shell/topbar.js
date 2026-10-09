// The bar above every app: back to the dashboard, switch apps, this build's version, Files and fullscreen.
import { appHref, currentApp, loadApps } from './apps.js'
import { toggleStack } from './stack.js'
import { h, icon, isolate } from './ui.js'

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS = [['year', 31536e3], ['month', 2592e3], ['week', 6048e2], ['day', 864e2], ['hour', 3600], ['minute', 60]]
const ago = (iso) => {
  const s = (Date.parse(iso) - Date.now()) / 1000
  const [unit, size] = UNITS.find(([, n]) => Math.abs(s) >= n) ?? ['minute', 60]
  return relative.format(Math.round(s / size), unit)
}

// The bar can be folded away (its arrow) and brought back (the tab at the top); the choice is kept in this browser.
// app.js applies it before the page draws.
const BAR_HIDDEN = 'pg-bar-hidden'
export const barHidden = () => {
  try {
    return localStorage.getItem(BAR_HIDDEN) === '1'
  } catch {
    return false
  }
}
function setBarHidden(hidden) {
  document.documentElement.toggleAttribute('data-pg-bar-hidden', hidden)
  try {
    if (hidden) localStorage.setItem(BAR_HIDDEN, '1')
    else localStorage.removeItem(BAR_HIDDEN)
  } catch {}
}

export async function mountTopbar() {
  const here = currentApp()

  // In fullscreen the bar hides (shell.css), so this only enters it; Esc leaves, as in any fullscreen page.
  const fullscreen = h('button', { class: 'pg-bar-btn', type: 'button', 'aria-label': 'Fullscreen', title: 'Fullscreen (Esc to exit)' }, icon('expand'))
  fullscreen.addEventListener('click', () => document.documentElement.requestFullscreen().catch(() => {}))

  // Everything that doesn't need apps.json goes up at once; the switcher and version join when the list arrives.
  const home = h('a', { class: 'pg-home', href: '/' }, h('img', { class: 'pg-mark', src: '/shell/artcraft-icon.svg', alt: '' }), h('span', { class: 'pg-label' }, 'Playground'))
  const bar = isolate(
    h(
      'header',
      { class: 'pg-bar' },
      home,
      h('span', { class: 'pg-spacer' }),
      h('button', { class: 'pg-bar-btn pg-files', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => toggleStack(e.currentTarget) }, icon('files'), h('span', { class: 'pg-label' }, 'Files')),
      fullscreen,
      h('button', { class: 'pg-collapse', type: 'button', 'aria-label': 'Hide the bar', title: 'Hide the bar', onclick: () => setBarHidden(true) }, icon('chevronUp')),
    ),
  )
  // While the bar is folded away, a small tab hangs from the top center of the screen to bring it back.
  const tab = isolate(h('button', { class: 'pg-bar-tab', type: 'button', 'aria-label': 'Show the bar', title: 'Show the bar', onclick: () => setBarHidden(false) }, icon('chevron')))
  document.body.prepend(bar, tab)

  const { groups } = await loadApps()
  const app = groups.flatMap((g) => g.apps).find((a) => a.slug === here?.slug)
  if (!app) return
  const build = app[here.channel]

  const menu = h(
    'div',
    { class: 'pg-apps', id: 'pg-apps', popover: 'auto', role: 'menu', 'aria-label': 'Apps' },
    groups.map((g) => [
      h('p', { class: 'pg-apps-group' }, g.name),
      g.apps.map((a) =>
        h(
          'a',
          { class: 'pg-app', role: 'menuitem', href: appHref(a), 'aria-current': a.slug === here.slug ? 'page' : null },
          h('img', { src: a.icon, alt: '' }),
          h('span', {}, h('strong', {}, a.name), h('small', {}, a.blurb)),
          a.slug === here.slug ? icon('check') : null,
        ),
      ),
    ]),
  )
  home.after(
    ...[
      h('button', { class: 'pg-switch', type: 'button', popovertarget: 'pg-apps', 'aria-haspopup': 'menu' }, h('img', { src: app.icon, alt: '' }), app.name, icon('chevron')),
      build &&
        h(
          'span',
          { class: `pg-version${here.channel === 'head' ? ' pg-head' : ''}`, title: here.channel === 'head' ? 'Latest commit (unstable)' : 'Release' },
          build.label + (here.channel === 'head' && build.date ? ` · ${ago(build.date)}` : ''),
        ),
    ].filter(Boolean),
  )
  bar.append(menu)
}

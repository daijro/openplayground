// The bar above every app: back to the dashboard, switch apps, this build's version, sharing, its source code, its
// license, Files and fullscreen.
import { appHref, currentApp, loadApps } from './apps.js'
import { toggleStack } from './stack.js'
import { mountShare } from './share.js'
import { h, icon, isolate, modal } from './ui.js'

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS = [['year', 31536e3], ['month', 2592e3], ['week', 6048e2], ['day', 864e2], ['hour', 3600], ['minute', 60]]
const ago = (iso) => {
  const s = (Date.parse(iso) - Date.now()) / 1000
  const [unit, size] = UNITS.find(([, n]) => Math.abs(s) >= n) ?? ['minute', 60]
  return relative.format(Math.round(s / size), unit)
}

// The bar can be folded away (its arrow) and brought back (the tab at the top); the choice is kept in this browser.
// app.js applies it before the page draws. Fullscreen folds it too, without changing the kept choice.
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
  if (document.fullscreenElement) return
  try {
    if (hidden) localStorage.setItem(BAR_HIDDEN, '1')
    else localStorage.removeItem(BAR_HIDDEN)
  } catch {}
}

export async function mountTopbar() {
  const here = currentApp()

  // Enters fullscreen, or leaves it (as Esc does). Fullscreen starts with the bar folded away, its tab showing.
  const fullscreen = h('button', { class: 'pg-bar-btn', type: 'button' })
  const showFullscreen = (on) => {
    fullscreen.replaceChildren(icon(on ? 'shrink' : 'expand'))
    fullscreen.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen')
    fullscreen.title = on ? 'Exit fullscreen (Esc)' : 'Fullscreen'
  }
  showFullscreen(false)
  fullscreen.addEventListener('click', () =>
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}),
  )
  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === document.documentElement
    showFullscreen(on)
    document.documentElement.toggleAttribute('data-pg-bar-hidden', on || barHidden())
  })

  // Everything that doesn't need apps.json goes up at once; the switcher and version join when the list arrives.
  const home = h('a', { class: 'pg-home', href: '/' }, h('img', { class: 'pg-mark', src: '/shell/playground-logo.svg', alt: '' }), h('span', { class: 'pg-label' }, 'Playground'))
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
  const app = groups.flatMap((g) => g.apps).find((a) => here && a[here.channel]?.path === here.path)
  if (!app) return
  if (app.notice) showNotice(app)
  mountShare(bar, app, here, groups).catch(() => {})
  const build = app[here.channel]
  // The tab reads "<app> - Playground", by the alternative's name under "Alternative naming" (which also swaps the
  // tab's icon). Apps that retitle themselves later are put back.
  const title = `${app.name} - Playground`
  const keepTitle = () => { if (document.title !== title) document.title = title }
  keepTitle()
  new MutationObserver(keepTitle).observe(document.head, { subtree: true, childList: true, characterData: true })
  if (app.own) document.querySelector('link[rel="icon"]')?.setAttribute('href', app.icon)

  const menu = h(
    'div',
    { class: 'pg-apps', id: 'pg-apps', popover: 'auto', role: 'menu', 'aria-label': 'Apps' },
    groups.map((g) => [
      h('p', { class: 'pg-apps-group' }, g.name),
      g.apps.map((a) =>
        h(
          'a',
          { class: 'pg-app', role: 'menuitem', href: appHref(a), 'aria-current': a.slug === app.slug ? 'page' : null },
          h('img', { src: a.icon, alt: '' }),
          h('span', {}, h('strong', {}, a.name), h('small', {}, a.own ? `Using ${a.own.name}` : a.alternative ? `Alternative to ${a.alternative}` : a.blurb)),
          a.slug === app.slug ? icon('check') : null,
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
  if (build?.source) mountSource(bar, app, build, here.path)
  mountLicense(bar, app, build)
}

// License: the app's copyright and licence, and that Playground changed it (tools.yaml `copyright` and `license`, the
// build's patches and date): the notices its licence asks a copy, and an interactive program, to show (GPL-3.0 §4, §5;
// MIT; Apache-2.0 §4). The full texts load from the app's repository at this build's version when asked for.
const LICENCES = {
  MIT: 'the MIT License',
  'Apache-2.0': 'the Apache License, Version 2.0',
  'GPL-3.0-only': 'the GNU General Public License, version 3',
  'GPL-3.0-or-later': 'the GNU General Public License as published by the Free Software Foundation, either version 3 of the License or (at your option) any later version',
}
const WARRANTY = {
  gpl: 'It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.',
  other: 'It is provided “as is”, without warranty of any kind, express or implied, including the warranties of merchantability, fitness for a particular purpose and noninfringement.',
}
function mountLicense(bar, app, build) {
  if (!app.license) return
  const name = (app.own ?? app).name
  const src = build?.source ?? null
  const ref = src?.ref ?? 'HEAD'
  const ids = app.license.split(' OR ')
  const gpl = ids.some((id) => id.startsWith('GPL'))
  const terms = ids.map((id) => LICENCES[id] ?? id).join(' or ') + (ids.length > 1 ? ', at your option' : '')
  const files = src?.licenses ?? ids.map((id) => ({ id, file: ids.length > 1 ? `LICENSE-${id.split('-')[0].toUpperCase()}` : 'LICENSE' }))
  const raw = (file) => `https://raw.githubusercontent.com/${app.repo}/${ref}/${file}`
  const page = (file) => `https://github.com/${app.repo}/blob/${ref}/${file}`
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text)
  const modified = src?.patches?.length > 0
  const built = build?.built ? new Date(build.built).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' }) : null
  const open = () =>
    modal(
      (done) => {
        const texts = h('div', { class: 'pg-license-texts', hidden: true })
        const full = h('button', { class: 'pg-btn', type: 'button' }, 'Show the full license')
        full.addEventListener('click', async () => {
          full.disabled = true
          texts.hidden = false
          // The licence files, and a NOTICE where the app has one (Apache-2.0 asks that it travel with the work).
          for (const file of [...files.map((f) => f.file), 'NOTICE']) {
            const text = await fetch(raw(file)).then((r) => (r.ok ? r.text() : null)).catch(() => null)
            if (text) texts.append(h('h3', {}, file), h('pre', {}, text))
            else if (file !== 'NOTICE') texts.append(h('p', {}, `Couldn’t load ${file} here: `, link(page(file), 'read it on GitHub'), '.'))
          }
          full.remove()
        })
        const close = h('button', { class: 'pg-btn pg-primary', type: 'button', onclick: () => done(null) }, 'Close')
        const el = h(
          'div',
          { class: 'pg-choice pg-license' },
          h('h2', { class: 'pg-title' }, `${name} license`),
          h('p', { class: 'pg-license-copyright' }, (app.copyright.length ? app.copyright : [`Copyright (c) the ${name} contributors`]).map((line) => h('span', {}, line))),
          h('p', {}, `${name} is free software: you can redistribute it and/or modify it under the terms of ${terms}.`),
          h('p', {}, gpl ? WARRANTY.gpl : WARRANTY.other),
          modified
            ? h('p', {}, `Playground modified it to run in a browser${built ? `; this build was made on ${built}` : ''}. Its changes are the patch files below, under the same license.`)
            : null,
          h(
            'ul',
            { class: 'pg-license-links' },
            h('li', {}, 'Source: ', link(src?.url ?? `https://github.com/${app.repo}`, `${app.repo}${src ? ` at ${src.ref}` : ''}`)),
            files.map((f) => h('li', {}, `License (${f.id}): `, link(page(f.file), f.file))),
            modified ? src.patches.map((p) => h('li', {}, 'Patches: ', link(p.url, p.path))) : null,
          ),
          texts,
          h('div', { class: 'pg-actions' }, full, close),
        )
        return { el, focus: () => close.focus() }
      },
      { label: `${name} license` },
    )
  const button = h('button', { class: 'pg-bar-btn pg-license-btn', type: 'button', 'aria-haspopup': 'dialog', title: 'Copyright and license', onclick: open }, icon('license'), h('span', { class: 'pg-label' }, 'License'))
  bar.querySelector('.pg-files').before(button)
}

// Source: the app's code at the version this build is of, its licence there, and the patch files Playground built it
// with, at the commit that built them (vite.config.js `source`); each opens on GitHub in a new tab.
function mountSource(bar, app, build, base) {
  const src = build.source
  const link = (name, title, detail, href) =>
    h('a', { class: 'pg-app', role: 'menuitem', href, target: '_blank', rel: 'noopener', onclick: () => menu.hidePopover() }, icon(name), h('span', {}, h('strong', {}, title), h('small', {}, detail)))
  const own = (app.own ?? app).name
  // The app as a standalone page (shell/standalone.js): a ZIP of this build's files, and a page that unzips and runs them.
  const detail = h('small', {}, 'A ZIP: the wasm and a page that runs it')
  const standalone = h('button', { class: 'pg-app', role: 'menuitem', type: 'button' }, icon('download'), h('span', {}, h('strong', {}, 'Download as a standalone page'), detail))
  standalone.addEventListener('click', async () => {
    standalone.disabled = true
    try {
      const { downloadStandalone } = await import('./standalone.js')
      await downloadStandalone(app, build, base, (done, total) => (detail.textContent = `Preparing… ${Math.round((done / total) * 100)}%`))
      detail.textContent = 'Downloaded'
    } catch (e) {
      detail.textContent = e.message
    }
    standalone.disabled = false
  })
  const menu = h(
    'div',
    { class: 'pg-apps pg-source', id: 'pg-source', popover: 'auto', role: 'menu', 'aria-label': 'Source code' },
    h('p', { class: 'pg-apps-group' }, `${own} source`),
    link('code', src.repo, `at ${src.ref}`, src.url),
    src.licenses.map((l) => link('file', `Licence: ${l.id}`, `${l.file} at ${src.ref}`, l.url)),
    src.patches.length
      ? [
          h('p', { class: 'pg-apps-group' }, "Playground's patches"),
          src.patches.map((p) => link(p.path.endsWith('/') ? 'folder' : 'file', p.path, `at ${src.commit?.slice(0, 7) ?? 'main'}`, p.url)),
          h('p', { class: 'pg-source-note' }, `Licensed like ${own}${src.license ? `: ${src.license}` : ''}.`),
        ]
      : h('p', { class: 'pg-source-note' }, `This is ${own}'s own release, unpatched.`),
    h('p', { class: 'pg-apps-group' }, 'Run it yourself'),
    standalone,
  )
  const button = h('button', { class: 'pg-bar-btn pg-source-btn', type: 'button', popovertarget: 'pg-source', 'aria-haspopup': 'menu', 'aria-label': 'Source code', title: 'Source code' }, icon('code'), h('span', { class: 'pg-label' }, 'Source'))
  // Source, then License (mountLicense), then Files.
  bar.querySelector('.pg-files').before(button)
  bar.append(menu)
}

// An app's notice (tools.yaml `notice`, e.g. a preview warning), each time it opens until "Don't show this again";
// a changed notice shows again.
function showNotice(app) {
  const key = `pg-notice-${app.slug}`
  try { if (localStorage.getItem(key) === app.notice.text) return } catch {}
  modal((done) => {
    const skip = h('input', { type: 'checkbox' })
    const ok = h('button', { class: 'pg-btn pg-primary', type: 'button', onclick: () => done(true) }, 'Continue')
    const el = h('div', { class: 'pg-choice' },
      h('h2', { class: 'pg-title' }, app.notice.title),
      h('p', { style: 'margin:0' }, app.notice.text),
      h('label', { class: 'pg-check' }, skip, "Don't show this again"),
      h('div', { class: 'pg-actions' }, h('a', { class: 'pg-btn', href: '/' }, 'Back to Playground'), ok))
    return { el, focus: () => ok.focus(), destroy: () => { try { if (skip.checked) localStorage.setItem(key, app.notice.text) } catch {} } }
  }, { label: app.notice.title })
}

// Small DOM helpers shared by the shell's top bar, explorer and dialogs.

/** h('button', { class: 'x', onclick }, 'Label', child) → element. `true` sets a boolean attribute. */
export const h = (tag, props = {}, ...children) => {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value)
    else if (key === 'class') el.className = value
    else el.setAttribute(key, value === true ? '' : value)
  }
  el.append(...children.flat().filter((c) => c != null && c !== false))
  return el
}

const FOLDER = '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h9A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>'
const ICONS = {
  folder: FOLDER,
  files: FOLDER,
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  newFolder: `${FOLDER}<path d="M12 10.5v5M9.5 13h5"/>`,
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6 6.5h.01M8.5 6.5h.01"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
}
export const icon = (name) => {
  const span = h('span', { class: 'pg-icon', 'aria-hidden': 'true' })
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
  return span
}

// Keys, text and clipboard events inside shell UI stop here: the app under it (eframe) listens on document.
const KEPT = ['keydown', 'keyup', 'keypress', 'input', 'paste', 'copy', 'cut', 'compositionstart', 'compositionupdate', 'compositionend']
export const isolate = (el) => {
  for (const type of KEPT) el.addEventListener(type, (e) => e.stopPropagation())
  return el
}

/**
 * Show `build(done)`'s view in a modal dialog; resolves with the value passed to done(), or null on Esc.
 * build returns { el, focus?, destroy? }.
 */
export const modal = (build, { label, className = '' } = {}) =>
  new Promise((resolve) => {
    const dialog = isolate(h('dialog', { class: `pg-modal ${className}`.trim(), 'aria-label': label }))
    let view
    const done = (value) => {
      if (!dialog.isConnected) return
      dialog.close()
      view?.destroy?.()
      dialog.remove()
      resolve(value ?? null)
    }
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault()
      done(null)
    })
    view = build(done)
    dialog.append(view.el)
    document.body.append(dialog)
    dialog.showModal()
    view.focus?.()
  })

/** A notice in the bottom corner. With actions it stays until used or dismissed; without, for 5 s. */
export const toast = (message, actions = []) => {
  let host = document.querySelector('.pg-toasts')
  if (!host) {
    host = isolate(h('div', { class: 'pg-toasts', role: 'status', 'aria-live': 'polite' }))
    document.body.append(host)
  }
  const close = () => el.remove()
  const el = h(
    'div',
    { class: 'pg-toast' },
    h('span', {}, message),
    actions.map(({ label, run }) => h('button', { class: 'pg-btn', type: 'button', onclick: () => (run(), close()) }, label)),
    h('button', { class: 'pg-btn pg-quiet', type: 'button', 'aria-label': 'Dismiss', onclick: close }, icon('close')),
  )
  host.append(el)
  if (!actions.length) setTimeout(close, 5000)
  return close
}

/** Ask inside `container` (positioned): resolves true for the confirm button, false for Cancel or Esc. */
export const confirmIn = (container, message, confirmLabel, { danger = false } = {}) =>
  new Promise((resolve) => {
    const finish = (value) => {
      box.remove()
      resolve(value)
    }
    const ok = h('button', { class: `pg-btn ${danger ? 'pg-danger' : 'pg-primary'}`, type: 'button', onclick: () => finish(true) }, confirmLabel)
    const box = h(
      'div',
      {
        class: 'pg-confirm',
        role: 'alertdialog',
        'aria-label': message,
        onkeydown: (e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          e.stopPropagation()
          finish(false)
        },
      },
      h('div', { class: 'pg-confirm-card' }, h('p', {}, message), h('div', { class: 'pg-actions' }, h('button', { class: 'pg-btn', type: 'button', onclick: () => finish(false) }, 'Cancel'), ok)),
    )
    container.append(box)
    ok.focus()
  })

/** Hand bytes to the browser as a download named `name`. */
export const download = (name, data) => {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]))
  const a = h('a', { href: url, download: name, hidden: true })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

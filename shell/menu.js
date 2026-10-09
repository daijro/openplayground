// The right-click menu for a file, shared by the Files list (explorer.js) and the Files fan (stack.js): every app
// that takes the file, each with its icon (the one it opens in by default first), then Download, Rename, Delete.
import { appsFor } from './paths.js'
import { h } from './ui.js'

/**
 * fileMenu({ host, x, y, entry, apps, onOpenInApp, onDownload, onRename, onDelete, onClose }) → close()
 * Shown inside `host` (a positioned element) at viewport point (x, y), kept within the host's box.
 */
export function fileMenu({ host, x, y, entry, apps, onOpenInApp, onDownload, onRename, onDelete, onClose = () => {} }) {
  host.querySelector(':scope > .pg-menu')?.remove()
  const item = (label, run, iconSrc) =>
    h('button', { class: 'pg-menu-item', role: 'menuitem', type: 'button', onclick: () => (close(), run()) }, iconSrc ? h('img', { src: iconSrc, alt: '' }) : null, label)
  const openers = appsFor(apps, entry.name).map((app) => item(`Open in ${app.name}`, () => onOpenInApp(entry.path, app), app.icon))
  const actions = [item('Download', onDownload), item('Rename', onRename), item('Delete', onDelete)]
  const el = h(
    'div',
    {
      class: 'pg-menu',
      role: 'menu',
      'aria-label': `Actions for ${entry.name}`,
      onkeydown: (e) => {
        const items = [...el.querySelectorAll('.pg-menu-item')]
        const i = items.indexOf(document.activeElement)
        if (e.key === 'Escape') close()
        else if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus()
        else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus()
        else return
        e.preventDefault()
        e.stopPropagation()
      },
    },
    openers,
    openers.length ? h('div', { class: 'pg-menu-sep', role: 'separator' }) : null,
    actions,
  )
  const outside = (e) => !el.contains(e.target) && close()
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    el.remove()
    removeEventListener('pointerdown', outside, true)
    onClose()
  }
  host.append(el)
  const box = host.getBoundingClientRect()
  el.style.left = `${Math.max(8, Math.min(x - box.left, box.width - el.offsetWidth - 8))}px`
  el.style.top = `${Math.max(8, Math.min(y - box.top, box.height - el.offsetHeight - 8))}px`
  addEventListener('pointerdown', outside, true)
  el.querySelector('.pg-menu-item')?.focus()
  return close
}

// The Files fan: the top bar's Files button fans the most recent files out like a Dock stack, hanging from the bar:
// newest nearest the button, curving down and to the left. Click a file to open it in its app; right-click it for
// every app that takes it, Download, Rename and Delete. The last item opens the full Files list.
import * as store from './store.js'
import { flatApps, loadApps } from './apps.js'
import { openFilesPopup, openInApp } from './files.js'
import { fileMenu } from './menu.js'
import { appFor, baseName, join, validName } from './paths.js'
import { confirmIn, download, h, icon, isolate, toast } from './ui.js'

const RECENT = 10
const STEP = 50 // px between items down the fan
const RADIUS = 1400 // of the circle the fan curves along: a gentle bend, ~20° by the last item, like the Dock fan
const TILE = 44

let current = null // the open fan

// Dragging a file out of the fan onto the app: a page can't put a file from its own storage into a drag by itself,
// so the drag carries the file's path, and the drop is replayed on whatever is under the pointer as an ordinary
// file drop with the file's bytes, the same drop the apps get when a file is dragged in from the computer.
const DRAG = 'application/x-playground-file'
addEventListener('dragover', (e) => e.dataTransfer?.types.includes(DRAG) && (e.preventDefault(), (e.dataTransfer.dropEffect = 'copy')), true)
addEventListener(
  'drop',
  async (e) => {
    const path = e.dataTransfer?.getData(DRAG)
    if (!path) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const { clientX, clientY } = e
    try {
      const file = new File([await store.read(path)], baseName(path))
      const target = document.elementFromPoint(clientX, clientY) ?? document.querySelector('canvas')
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      const at = { clientX, clientY, bubbles: true, cancelable: true, dataTransfer }
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, at))
    } catch (err) {
      toast(`Couldn’t drop ${baseName(path)}: ${err.message}`)
    }
  },
  true,
)

/** Open the fan under `button`, or close it if it's open. */
export function toggleStack(button) {
  if (current) current.close()
  else current = fan(button)
}

function fan(button) {
  const items = h('div', { class: 'pg-stack-items', role: 'menu', 'aria-label': 'Recent files' })
  const overlay = isolate(h('div', { class: 'pg-stack' }, items))
  let files = []
  let apps = []
  let renaming = false
  let closed = false

  const r = button.getBoundingClientRect()
  items.style.top = `${r.bottom + 8}px`
  items.style.right = `${innerWidth - (r.left + r.width / 2) - TILE / 2}px`

  // Item i of the fan: its place on the arc (down, curving left) and its tilt along it.
  const place = (el, i) => {
    const y = i * STEP
    const x = RADIUS - Math.sqrt(RADIUS * RADIUS - y * y)
    el.style.setProperty('--x', `${-x}px`)
    el.style.setProperty('--y', `${y}px`)
    el.style.setProperty('--r', `${(Math.asin(y / RADIUS) * 180) / Math.PI}deg`)
    el.style.setProperty('--i', i)
    return el
  }

  const tile = (content) => h('span', { class: 'pg-stack-tile' }, content)
  const label = (text) => h('span', { class: 'pg-stack-label' }, text)

  function fileItem(entry, i) {
    const app = appFor(apps, entry.name)
    return place(
      h(
        'button',
        {
          class: 'pg-stack-item',
          type: 'button',
          role: 'menuitem',
          'data-path': entry.path,
          onclick: () => {
            if (renaming) return
            close()
            if (app) openInApp(entry.path, app)
            else saveToDevice(entry)
          },
          oncontextmenu: (e) => {
            e.preventDefault()
            menu(entry, e.clientX, e.clientY)
          },
          draggable: 'true',
          ondragstart: (e) => {
            e.dataTransfer.setData(DRAG, entry.path)
            e.dataTransfer.setData('text/plain', entry.name)
            e.dataTransfer.effectAllowed = 'copy'
            setTimeout(() => overlay.classList.add('pg-dragging')) // the fan steps aside so the app gets the drop
          },
          ondragend: () => close(),
        },
        label(entry.name),
        tile(app ? h('img', { src: app.icon, alt: '' }) : icon('file')),
      ),
      i,
    )
  }

  function render(instant = false) {
    const shown = files.slice(0, RECENT)
    const rows = shown.map(fileItem)
    if (!shown.length) rows.push(place(h('div', { class: 'pg-stack-item pg-stack-note' }, label('No files yet. Save one from an app, or drop files into Files.')), 0))
    rows.push(
      place(
        h('button', { class: 'pg-stack-item pg-stack-all', type: 'button', role: 'menuitem', onclick: () => (close(), openFilesPopup()) }, label('Open Files'), tile(icon('folder'))),
        rows.length,
      ),
    )
    if (instant) overlay.classList.add('pg-instant')
    items.replaceChildren(...rows)
    if (instant) requestAnimationFrame(() => overlay.classList.remove('pg-instant'))
  }

  async function load(instant) {
    const listed = (await store.available()) ? (await store.flattenOnce(), await store.list('/')) : []
    files = listed.filter((e) => e.kind === 'file').sort((a, b) => b.modified - a.modified)
    if (!closed && !renaming) render(instant)
  }

  const saveToDevice = async (entry) => download(entry.name, await store.read(entry.path))

  const menu = (entry, x, y) =>
    fileMenu({
      host: overlay,
      x,
      y,
      entry,
      apps,
      onOpenInApp: (path, app) => (close(), openInApp(path, app)),
      onDownload: () => saveToDevice(entry).catch((e) => toast(`Couldn’t download ${entry.name}: ${e.message}`)),
      onRename: () => rename(entry),
      onDelete: async () => {
        if (await confirmIn(overlay, `Delete ${entry.name}? This can’t be undone.`, 'Delete', { danger: true })) {
          await store.remove(entry.path).catch((e) => toast(`Couldn’t delete ${entry.name}: ${e.message}`))
        }
        focusItem(0)
      },
    })

  function rename(entry) {
    const item = [...items.children].find((el) => el.dataset.path === entry.path)
    const pill = item?.querySelector('.pg-stack-label')
    if (!pill) return
    renaming = true
    const input = h('input', { class: 'pg-stack-rename', value: entry.name, 'aria-label': `New name for ${entry.name}`, spellcheck: 'false' })
    pill.replaceChildren(input)
    input.focus()
    const dot = entry.name.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length)
    let done = false
    const finish = async (commit) => {
      if (done) return
      done = true
      const next = input.value.trim()
      try {
        if (commit && next !== entry.name) {
          if (!validName(next)) throw new Error(`“${next}” isn’t a valid name`)
          if (files.some((f) => f.name === next)) throw new Error(`${next} already exists`)
          await store.move(entry.path, join('/', next))
        }
      } catch (e) {
        toast(`Couldn’t rename ${entry.name}: ${e.message}.`)
      }
      renaming = false
      await load(true)
      focusItem(Math.max(0, files.findIndex((f) => f.name === (commit ? next : entry.name))))
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') finish(true)
      else if (e.key === 'Escape') finish(false)
    })
    input.addEventListener('blur', () => finish(true))
    input.addEventListener('click', (e) => e.stopPropagation())
  }

  const menuItems = () => [...items.querySelectorAll('[role="menuitem"]')]
  const focusItem = (i) => menuItems()[i]?.focus()

  items.addEventListener('keydown', (e) => {
    const all = menuItems()
    const i = all.indexOf(document.activeElement)
    const entry = files[i]
    if (e.key === 'ArrowDown') focusItem((i + 1) % all.length)
    else if (e.key === 'ArrowUp') focusItem((i - 1 + all.length) % all.length)
    else if (e.key === 'Home') focusItem(0)
    else if (e.key === 'End') focusItem(all.length - 1)
    else if (entry && e.key === 'F2') rename(entry)
    else if (entry && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
      const box = all[i].getBoundingClientRect()
      menu(entry, box.left, box.bottom)
    } else return
    e.preventDefault()
  })
  overlay.addEventListener('keydown', (e) => e.key === 'Escape' && !e.defaultPrevented && close())
  // Esc with the focus elsewhere (still on the Files button, or in the app) closes it too.
  const escape = (e) => e.key === 'Escape' && !overlay.contains(e.target) && close()
  addEventListener('keydown', escape, true)
  overlay.addEventListener('click', (e) => e.target === overlay && close())
  overlay.addEventListener('contextmenu', (e) => e.target === overlay && (e.preventDefault(), close()))

  const unsubscribe = store.onChange((dir) => dir === '/' && load(true))
  addEventListener('resize', close)

  function close() {
    if (closed) return
    closed = true
    current = null
    unsubscribe()
    removeEventListener('resize', close)
    removeEventListener('keydown', escape, true)
    button.setAttribute('aria-expanded', 'false')
    overlay.classList.remove('pg-open')
    overlay.classList.add('pg-closing')
    setTimeout(() => overlay.remove(), 260)
    if (overlay.contains(document.activeElement)) button.focus()
  }

  document.body.append(overlay)
  button.setAttribute('aria-expanded', 'true')
  Promise.all([loadApps().then((data) => (apps = flatApps(data))), load()]).then(() => {
    render()
    // Next frame, so the items start folded at the button and spring out from there.
    requestAnimationFrame(() => requestAnimationFrame(() => !closed && (overlay.classList.add('pg-open'), focusItem(0))))
  })
  return { close }
}

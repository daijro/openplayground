// The file explorer: the one flat list of files in the browser file store (store.js), in three modes. 'browse' is
// the Files popup in apps and the /files/ page; 'open' is an app's Open; 'save' is an app's Save As (step 2, after
// files.js asks "Keep in browser storage / Download to device").
import * as store from './store.js'
import { fileMenu } from './menu.js'
import { appFor, formatSize, formatWhen, join, matchesTypes, uniqueName, validName, withType } from './paths.js'
import { confirmIn, download, h, icon } from './ui.js'

const rowId = (path) => `pg-row-${encodeURIComponent(path)}`

/**
 * explorer({ mode, types, name, apps, closable, onDone, onOpenInApp }) → { el, ready, focus(), destroy() }
 * - mode: 'browse' | 'open' | 'save'
 * - types: extensions; open mode lists only these (with an "All files" switch), save mode adds the first to a
 *   name that has none of them
 * - name: the suggested name in save mode
 * - apps: the flat app list (apps.js), for file icons and "Open in app"
 * - closable: browse mode shows a Close button that calls onDone(null)
 * - onDone(result): open → a store path, or { computer: File } for "From computer…"; save → a store path;
 *   null for Cancel / Close
 * - onOpenInApp(path, app): browse mode's "Open in <app>"
 */
export function explorer({ mode = 'browse', types = [], name = '', apps = [], closable = false, onDone = () => {}, onOpenInApp = () => {} }) {
  let entries = []
  let selected = null
  let allTypes = false

  const uploadInput = h('input', {
    type: 'file',
    multiple: true,
    hidden: true,
    onchange: () => upload([...uploadInput.files]).finally(() => (uploadInput.value = '')),
  })
  const head = h(
    'header',
    { class: 'pg-ex-head' },
    h('h2', { class: 'pg-ex-title' }, 'Files'),
    h('div', { class: 'pg-ex-tools' }, h('button', { class: 'pg-btn', type: 'button', onclick: () => uploadInput.click() }, icon('upload'), 'Upload'), uploadInput),
  )
  const list = h('div', { class: 'pg-ex-list', role: 'listbox', tabindex: '0', 'aria-label': 'Files', onkeydown: onListKey })
  const status = h('p', { class: 'pg-ex-status', role: 'status', 'aria-live': 'polite' })
  const foot = h('footer', { class: 'pg-ex-foot' })
  const root = h('div', { class: 'pg-explorer', 'data-mode': mode }, head, list, status, foot)

  // Mode footers.
  let nameInput = null
  let openButton = null
  if (mode === 'open') {
    const pick = h('input', {
      type: 'file',
      hidden: true,
      accept: types.map((t) => `.${t}`).join(','),
      onchange: () => pick.files[0] && onDone({ computer: pick.files[0] }),
    })
    openButton = h('button', { class: 'pg-btn pg-primary', type: 'button', disabled: true, onclick: () => selectedFile() && onDone(selected) }, 'Open')
    foot.append(
      types.length
        ? h('label', { class: 'pg-check' }, h('input', { type: 'checkbox', onchange: (e) => ((allTypes = e.target.checked), render()) }), 'All files')
        : h('span'),
      h(
        'div',
        { class: 'pg-actions' },
        h('button', { class: 'pg-btn', type: 'button', onclick: () => pick.click() }, icon('computer'), 'From computer…'),
        pick,
        h('button', { class: 'pg-btn', type: 'button', onclick: () => onDone(null) }, 'Cancel'),
        openButton,
      ),
    )
  } else if (mode === 'save') {
    nameInput = h('input', {
      class: 'pg-input',
      type: 'text',
      value: name,
      'aria-label': 'File name',
      spellcheck: 'false',
      autocomplete: 'off',
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          save()
        }
      },
    })
    foot.append(
      h('label', { class: 'pg-name' }, h('span', {}, 'Name'), nameInput),
      h(
        'div',
        { class: 'pg-actions' },
        h('button', { class: 'pg-btn', type: 'button', onclick: () => onDone(null) }, 'Cancel'),
        h('button', { class: 'pg-btn pg-primary', type: 'button', onclick: () => save() }, 'Save'),
      ),
    )
  } else {
    const usage = h('span', { class: 'pg-ex-usage' }, 'Kept in this browser until you clear this site’s data.')
    store.usage().then(({ usage: used }) => {
      if (used) usage.textContent = `This site uses ${formatSize(used)} of browser storage. Files stay until you clear this site’s data.`
    })
    foot.append(usage)
    if (closable) foot.append(h('button', { class: 'pg-btn', type: 'button', onclick: () => onDone(null) }, 'Close'))
  }

  // Listing.
  const visible = () => entries.filter((e) => mode !== 'open' || allTypes || matchesTypes(e.name, types))
  const selectedFile = () => entries.find((e) => e.path === selected)

  let seq = 0
  async function load() {
    const mine = ++seq
    try {
      const listed = (await store.list('/')).filter((e) => e.kind === 'file')
      if (mine !== seq) return // superseded by a newer load()
      entries = listed
      if (!entries.some((e) => e.path === selected)) selected = null
      render()
    } catch (e) {
      if (mine === seq) showError(e)
    }
  }

  function render() {
    const rows = visible()
    list.replaceChildren(...rows.map(row))
    if (!rows.length) {
      list.append(h('p', { class: 'pg-ex-empty' }, mode === 'open' && entries.length ? 'No files of this type here.' : 'No files yet. Drop files here to upload them.'))
    }
    list.setAttribute('aria-activedescendant', selected && rows.some((r) => r.path === selected) ? rowId(selected) : '')
    if (openButton) openButton.disabled = !selectedFile()
  }

  function row(entry) {
    const app = appFor(apps, entry.name)
    return h(
      'div',
      {
        class: 'pg-row',
        role: 'option',
        id: rowId(entry.path),
        'aria-selected': String(entry.path === selected),
        'data-path': entry.path,
        onclick: () => select(entry.path),
        ondblclick: () => activate(entry),
        oncontextmenu: (e) => {
          if (mode !== 'browse') return
          e.preventDefault()
          select(entry.path)
          menu(entry, e.clientX, e.clientY)
        },
      },
      app ? h('img', { class: 'pg-row-icon', src: app.icon, alt: '' }) : icon('file'),
      h('span', { class: 'pg-row-name' }, entry.name),
      h('span', { class: 'pg-row-size' }, formatSize(entry.size)),
      h('span', { class: 'pg-row-when' }, entry.modified ? formatWhen(entry.modified) : ''),
      mode === 'browse'
        ? h(
            'button',
            {
              class: 'pg-row-more',
              type: 'button',
              'aria-label': `Actions for ${entry.name}`,
              onclick: (e) => {
                e.stopPropagation()
                select(entry.path)
                const r = e.currentTarget.getBoundingClientRect()
                menu(entry, r.right, r.bottom)
              },
            },
            icon('more'),
          )
        : null,
    )
  }

  function select(path) {
    selected = path
    for (const el of list.querySelectorAll('.pg-row')) el.setAttribute('aria-selected', String(el.dataset.path === path))
    list.setAttribute('aria-activedescendant', path ? rowId(path) : '')
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    const file = selectedFile()
    if (nameInput && file) nameInput.value = file.name
    if (openButton) openButton.disabled = !file
  }

  function activate(entry) {
    if (mode === 'open') return onDone(entry.path)
    if (mode === 'save') {
      nameInput.value = entry.name
      return save()
    }
    const app = appFor(apps, entry.name)
    if (app) onOpenInApp(entry.path, app)
    else downloadEntry(entry)
  }

  function onListKey(e) {
    if (e.target !== list) return // keys typed while renaming belong to the rename field
    const rows = visible()
    const i = rows.findIndex((r) => r.path === selected)
    const to = (j) => {
      e.preventDefault()
      if (rows.length) select(rows[Math.max(0, Math.min(rows.length - 1, j))].path)
    }
    if (e.key === 'ArrowDown') to(i + 1)
    else if (e.key === 'ArrowUp') to(i < 0 ? 0 : i - 1)
    else if (e.key === 'Home') to(0)
    else if (e.key === 'End') to(rows.length - 1)
    else if (e.key === 'Enter' && i >= 0) {
      e.preventDefault()
      activate(rows[i])
    } else if (e.key === 'Delete' && i >= 0) {
      e.preventDefault()
      remove(rows[i])
    } else if (e.key === 'F2' && i >= 0) {
      e.preventDefault()
      rename(rows[i])
    } else if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && i >= 0 && mode === 'browse') {
      e.preventDefault()
      const r = document.getElementById(rowId(rows[i].path)).getBoundingClientRect()
      menu(rows[i], r.left + 40, r.bottom)
    }
  }

  // Browse mode's row menu, at viewport point (x, y).
  const menu = (entry, x, y) =>
    fileMenu({
      host: root,
      x,
      y,
      entry,
      apps,
      onOpenInApp,
      onDownload: () => downloadEntry(entry),
      onRename: () => rename(entry),
      onDelete: () => remove(entry),
      onClose: () => document.activeElement === document.body && list.focus(),
    })

  // Actions.
  async function guard(task) {
    try {
      return await task()
    } catch (e) {
      showError(e)
    }
  }
  function setStatus(text) {
    status.textContent = text
    status.classList.remove('pg-error')
  }
  function showError(e) {
    console.error(e)
    status.textContent = e?.message ?? String(e)
    status.classList.add('pg-error')
  }

  async function upload(files) {
    if (!files.length) return
    const taken = new Set(entries.map((e) => e.name))
    let done = 0
    let failure
    for (const file of files) {
      const fileName = uniqueName(file.name, taken)
      taken.add(fileName)
      try {
        await store.write(join('/', fileName), file)
        done++
      } catch (e) {
        console.error(e)
        failure ??= e
      }
    }
    if (failure) showError(new Error(`Uploaded ${done} of ${files.length} files: ${failure.message ?? failure}`))
    else setStatus(`Uploaded ${files.length === 1 ? files[0].name : `${files.length} files`}.`)
  }

  const downloadEntry = (entry) => guard(async () => download(entry.name, await store.read(entry.path)))

  function rename(entry) {
    const cell = document.getElementById(rowId(entry.path))?.querySelector('.pg-row-name')
    if (!cell) return
    const input = h('input', { class: 'pg-input pg-rename', value: entry.name, 'aria-label': `New name for ${entry.name}`, spellcheck: 'false' })
    cell.replaceChildren(input)
    input.focus()
    const dot = entry.name.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length)
    let finished = false
    const finish = async (commit) => {
      if (finished) return
      finished = true
      const next = input.value.trim()
      if (!commit || next === entry.name) return render(), list.focus()
      if (!validName(next)) return showError(new Error(`“${next}” isn’t a valid name.`)), render(), list.focus()
      if (entries.some((e) => e.name === next)) return showError(new Error(`${next} already exists.`)), render(), list.focus()
      selected = join('/', next)
      await guard(() => store.move(entry.path, selected))
      await load()
      list.focus()
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
      }
    })
    input.addEventListener('blur', () => finish(true))
    for (const type of ['click', 'dblclick']) input.addEventListener(type, (e) => e.stopPropagation())
  }

  async function remove(entry) {
    if (await confirmIn(root, `Delete ${entry.name}? This can’t be undone.`, 'Delete', { danger: true })) await guard(() => store.remove(entry.path))
    list.focus()
  }

  async function save() {
    const typed = nameInput.value.trim()
    if (!validName(typed)) {
      showError(new Error(typed ? `“${typed}” isn’t a valid file name.` : 'Type a name for the file.'))
      return nameInput.focus()
    }
    const fileName = withType(typed, types)
    if (entries.some((e) => e.name === fileName) && !(await confirmIn(root, `Replace ${fileName}?`, 'Replace'))) return nameInput.focus()
    onDone(join('/', fileName))
  }

  // Files dropped from the computer anywhere on the explorer upload; nothing else is a drop target.
  root.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    root.classList.add('pg-drop')
  })
  root.addEventListener('dragleave', (e) => !root.contains(e.relatedTarget) && root.classList.remove('pg-drop'))
  root.addEventListener('drop', (e) => {
    root.classList.remove('pg-drop')
    if (!e.dataTransfer.files.length) return
    e.preventDefault()
    upload([...e.dataTransfer.files])
  })

  const unsubscribe = store.onChange((changed) => changed === '/' && load())
  const ready = store.available().then(async (ok) => {
    if (ok) {
      await store.flattenOnce()
      return load()
    }
    head.hidden = true
    list.replaceChildren(h('p', { class: 'pg-ex-empty' }, 'Browser storage isn’t available in this window (for example, a private window).'))
  })
  return {
    el: root,
    ready,
    focus() {
      if (!nameInput) return list.focus()
      nameInput.focus()
      const dot = nameInput.value.lastIndexOf('.')
      nameInput.setSelectionRange(0, dot > 0 ? dot : nameInput.value.length)
    },
    destroy: unsubscribe,
  }
}

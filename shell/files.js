// globalThis.playgroundFiles: the browser file storage API the apps' patches call (patches/<app>.yaml has
// the Rust side), plus the Open, Save As and Files dialogs built on the explorer. Loaded on app pages by
// app.js. App paths are 'browser:/Folder/name.ext' (paths.js).
//
//   open({ types })               → [{ path, name, bytes }] | null    the explorer's Open; "From computer…"
//                                                                    gives a file with path: null
//   saveAs({ name, types, bytes }) → { path } | { download: true } | null
//                                    Keep → explorer Save; Download → the shell downloads `bytes` itself
//   write(path, bytes)            queued store write; a failure shows "Download instead"
//   read(path)                    → Promise<Uint8Array>
//   download(name, bytes)
//   setUnsaved(unsaved)           the app's own unsaved state, for the leave warning
//   onOpen(callback)              files for this app: ?open=browser:/… at startup, and "Open in <app>" in
//                                 the Files popup; apps that never register get them as a dropped file
import * as store from './store.js'
import { appHref, currentApp, flatApps, loadApps } from './apps.js'
import { explorer } from './explorer.js'
import { baseName, fromAppPath, toAppPath } from './paths.js'
import { download, h, icon, modal, toast } from './ui.js'

let handler = null
let lastSaveOrOpen = Date.now()
/** When the app last saved or opened a file (the leave warning compares it with the last input). */
export const savedAt = () => lastSaveOrOpen
const mark = () => (lastSaveOrOpen = Date.now())

// An app that tracks its own unsaved state reports it (its patch calls setUnsaved from its frame loop); the
// leave warning then follows it instead of guessing from input. null until an app reports.
let reportedUnsaved = null
export const unsavedReported = () => reportedUnsaved
const setUnsaved = (unsaved) => {
  reportedUnsaved = !!unsaved
}

const fileAt = async (path) => ({ path: toAppPath(path), name: baseName(path), bytes: await store.read(path) })

/** Give a stored file to the app on this page: its onOpen callback, else a file dropped on its canvas. */
export async function openHere(path) {
  const file = await fileAt(path)
  mark()
  if (handler) return handler(file)
  const canvas = document.querySelector('canvas')
  if (!canvas) return
  const dataTransfer = new DataTransfer()
  dataTransfer.items.add(new File([file.bytes], file.name))
  const r = canvas.getBoundingClientRect()
  const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, dataTransfer }
  for (const type of ['dragenter', 'dragover', 'drop']) canvas.dispatchEvent(new DragEvent(type, at))
}

async function open({ types = [] } = {}) {
  const apps = flatApps(await loadApps())
  const picked = await modal((done) => explorer({ mode: 'open', types, apps, onDone: done }), { label: 'Open' })
  if (!picked) return null
  mark()
  if (picked.computer) return [{ path: null, name: picked.computer.name, bytes: new Uint8Array(await picked.computer.arrayBuffer()) }]
  return [await fileAt(picked)]
}

async function saveAs({ name = 'Untitled', types = [], bytes = new Uint8Array() } = {}) {
  const apps = flatApps(await loadApps())
  const available = await store.available()
  const answer = await modal(
    (done) => {
      let saving = null
      const keep = h(
        'button',
        {
          class: 'pg-option',
          type: 'button',
          disabled: !available,
          onclick: () => {
            saving = explorer({ mode: 'save', types, name, apps, onDone: done })
            view.replaceWith(saving.el)
            saving.ready.then(() => saving.focus())
          },
        },
        icon('browser'),
        h('span', {}, h('strong', {}, 'Keep in browser storage'), h('small', {}, available ? 'Saved to Files in this browser. Save and AutoSave keep it up to date.' : 'Browser storage isn’t available in this window.')),
      )
      const toDevice = h(
        'button',
        { class: 'pg-option', type: 'button', onclick: () => done({ download: true }) },
        icon('download'),
        h('span', {}, h('strong', {}, 'Download to device'), h('small', {}, 'A copy goes to your downloads. The next Save asks again.')),
      )
      const view = h(
        'div',
        { class: 'pg-choice' },
        h('h2', { class: 'pg-title' }, `Save “${name}”`),
        keep,
        toDevice,
        h('div', { class: 'pg-actions' }, h('button', { class: 'pg-btn', type: 'button', onclick: () => done(null) }, 'Cancel')),
      )
      return { el: view, focus: () => (available ? keep : toDevice).focus(), destroy: () => saving?.destroy() }
    },
    { label: 'Save As' },
  )
  if (!answer) return null
  if (answer.download) {
    download(name, bytes)
    return { download: true }
  }
  mark()
  store.persist()
  return { path: toAppPath(answer) }
}

function write(appPath, bytes) {
  const path = fromAppPath(appPath)
  if (!path) throw new Error(`${appPath} isn't a browser storage path`)
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  mark()
  store.write(path, data).catch((e) => {
    console.error(`playgroundFiles: couldn't save ${path}`, e)
    const full = e?.name === 'QuotaExceededError'
    toast(`Couldn’t save ${baseName(path)} to browser storage${full ? ': it’s full' : ''}.`, [{ label: 'Download instead', run: () => download(baseName(path), data) }])
  })
}

function read(appPath) {
  const path = fromAppPath(appPath)
  return path ? store.read(path) : Promise.reject(new Error(`${appPath} isn't a browser storage path`))
}

// ?open=browser:/… (from the Files page or another app): hand it to this app once it can take it.
const startupPath = fromAppPath(new URLSearchParams(location.search).get('open'))
let startupDone = !startupPath
function startup() {
  if (startupDone) return
  startupDone = true
  const url = new URL(location.href)
  url.searchParams.delete('open')
  history.replaceState(history.state, '', url)
  openHere(startupPath).catch(() => toast(`Couldn’t open ${baseName(startupPath)}: it isn’t in Files anymore.`))
}
// Apps that never call onOpen get it dropped on their canvas, a moment after their loading screen is gone.
if (startupPath) {
  const begun = Date.now()
  const wait = () => {
    if (startupDone) return
    // Started = eframe has sized the canvas (HTML default is 300x150) and the loader is gone.
    const canvas = document.querySelector('body > canvas')
    const loaded = canvas && (canvas.width !== 300 || canvas.height !== 150) && !document.querySelector('#loading, [id$="_loading"]')
    if (loaded || Date.now() - begun > 120_000) setTimeout(startup, 1500)
    else setTimeout(wait, 250)
  }
  wait()
}

function onOpen(callback) {
  handler = callback
  startup()
}

/** The Files button: the explorer as a popup. "Open in <app>" opens files of this app here, others there. */
/** Open a stored file in `app`: here if it's this page's app, else on that app's page (?open=). */
export function openInApp(path, app) {
  if (app.slug !== currentApp()?.slug) return (location.href = `${appHref(app)}?open=${encodeURIComponent(toAppPath(path))}`)
  openHere(path).catch((e) => toast(`Couldn’t open ${baseName(path)}: ${e.message}`))
}

/** The full Files list as a popup (the fan's Open Files). */
export async function openFilesPopup() {
  const apps = flatApps(await loadApps())
  await modal(
    (done) =>
      explorer({
        mode: 'browse',
        apps,
        closable: true,
        onDone: done,
        onOpenInApp: (path, app) => {
          done(null)
          openInApp(path, app)
        },
      }),
    { label: 'Files' },
  )
}

globalThis.playgroundFiles = Object.freeze({ open, saveAs, write, read, download, onOpen, setUnsaved })

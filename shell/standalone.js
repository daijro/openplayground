// "Download as a standalone page" (the bar's Source menu): the app's files from this build as one ZIP, with its page
// made standalone: the shell (top bar, file explorer) left out, `playgroundFiles` given a small stand-in on the browser's
// own file picker and downloads, and the app's licence notice added. The .wasm.gz files stay as they are: the page's
// inline script unzips them in the browser (scripts/page-prelude.js), as on the site.
import { download } from './ui.js'

// ---- ZIP (stored: the wasm is already gzipped) ----
const table = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes) => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** [{ name, bytes }] → a ZIP Blob. `bytes` are read one at a time; the Blob keeps them (the browser may hold them on disk). */
async function zip(entries) {
  const encoder = new TextEncoder()
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const parts = []
  const central = []
  let offset = 0
  for (const { name, blob } of entries) {
    const n = encoder.encode(name)
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()))
    const local = new DataView(new ArrayBuffer(30))
    // Signature, version 2.0, flags (bit 11: UTF-8 names), stored, time, date, CRC, sizes, name length.
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, blob.size, true)
    local.setUint32(22, blob.size, true)
    local.setUint16(26, n.length, true)
    parts.push(local, n, blob)
    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(4, 20, true)
    dir.setUint16(6, 20, true)
    dir.setUint16(8, 0x0800, true)
    dir.setUint16(12, time, true)
    dir.setUint16(14, date, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, blob.size, true)
    dir.setUint32(24, blob.size, true)
    dir.setUint16(28, n.length, true)
    dir.setUint32(42, offset, true)
    central.push(dir, n)
    offset += 30 + n.length + blob.size
  }
  const size = central.reduce((s, p) => s + p.byteLength, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end], { type: 'application/zip' })
}

// ---- the page ----

// Stands in for shell/files.js: no browser storage or explorer, the browser's own picker and downloads. What an app
// writes stays in memory until the page is closed. (`browser:/…` paths are the shell's; the app only passes them back.)
const FILES = `<script id="playground-standalone">{
  const memory = new Map()
  const save = (name, bytes) => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([bytes])), download: name.split('/').pop() })
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 60000)
  }
  let unsaved = false
  addEventListener('beforeunload', (e) => unsaved && e.preventDefault())
  globalThis.playgroundFiles = Object.freeze({
    open: ({ types = [] } = {}) => new Promise((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: types.map((t) => '.' + t.replace(/^\\./, '')).join(',') })
      input.addEventListener('change', async () => resolve(input.files.length ? await Promise.all([...input.files].map(async (f) => ({ path: null, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))) : null))
      input.addEventListener('cancel', () => resolve(null))
      input.click()
    }),
    saveAs: async ({ name, bytes } = {}) => (bytes && save(name, bytes), { download: true }),
    write: (path, bytes) => void memory.set(path, bytes),
    read: async (path) => memory.get(path) ?? Promise.reject(new Error('no file ' + path)),
    files: async (folder) => [...memory.keys()].filter((p) => p.startsWith(folder)),
    remove: async (path) => void [...memory.keys()].filter((p) => p === path || p.startsWith(path + '/')).forEach((p) => memory.delete(p)),
    download: save,
    setUnsaved: (value) => void (unsaved = !!value),
    onOpen: () => {},
  })
}</script>`

// The installed page with the shell's tags out, and the Files stand-in ahead of everything else in <head>.
export const standalonePage = (html) =>
  html
    .replace(/\s*<link rel="stylesheet" href="\/shell\/shell\.css">/g, '')
    .replace(/\s*<script type="module" src="\/shell\/app\.js"><\/script>/g, '')
    .replace(/<meta charset[^>]*>/i, (m) => `${m}\n  ${FILES}`)

// The notice Playground's License button shows, with the app: its copyright, licence, source and Playground's changes.
export function notice(app, build) {
  const name = (app.own ?? app).name
  const src = build.source
  const lines = [
    `${name}, as a standalone copy of the build on Playground (${build.label})`,
    '',
    ...(app.copyright.length ? app.copyright : [`Copyright (c) the ${name} contributors`]),
    '',
    `${name} is distributed under the ${app.license ?? 'licence'} licence. The full text is in the LICENSE file(s) of its source:`,
    ...(src?.licenses?.length ? src.licenses.map((l) => `  ${l.id}: ${l.url}`) : [`  https://github.com/${app.repo}`]),
    '',
    `Source: ${src?.url ?? `https://github.com/${app.repo}`}`,
  ]
  if (src?.patches?.length) lines.push('', 'Playground modified it to run in a browser. Its changes are these files, under the same licence:', ...src.patches.map((p) => `  ${p.url}`))
  return lines.join('\n') + '\n'
}

const README = (name, isolated) => `${name}, standalone

Serve this folder with any static web server and open it in a browser, for example:

    python3 -m http.server 8000      then open http://localhost:8000/

(Opening index.html from the disk doesn't work: browsers don't let a file:// page fetch its own files.)
${isolated ? '\nThis app needs these response headers from the server:\n    Cross-Origin-Opener-Policy: same-origin\n    Cross-Origin-Embedder-Policy: require-corp\n' : ''}
The .wasm.gz files are unzipped by the page itself. Open and Save use the browser's own file picker and downloads.
See NOTICE.txt for the licence.
`

/**
 * Download the app as a ZIP. `base` is the build's folder ('/head/word/'); progress(done, total) is called as files arrive.
 * Throws if the build has no manifest (a stand-in) or a file can't be fetched.
 */
export async function downloadStandalone(app, build, base, progress = () => {}) {
  const folder = base.split('/').filter(Boolean).pop()
  const res = await fetch(`${base}playground-manifest.json`)
  if (!res.ok) throw new Error('This build has no file list yet.')
  const files = await res.json()
  const name = (app.own ?? app).name
  const entries = []
  let done = 0
  const total = files.reduce((n, f) => n + f.size, 0)
  const queue = [...files]
  const worker = async () => {
    for (let f; (f = queue.shift()); ) {
      const r = await fetch(`${base}${f.path.split('/').map(encodeURIComponent).join('/')}`)
      if (!r.ok) throw new Error(`Couldn't fetch ${f.path} (${r.status}).`)
      let blob = await r.blob()
      // A host that sends a .gz file with Content-Encoding: gzip (Vite's dev server does) has had it unzipped by fetch:
      // zip it again, so the copy holds what the site stores.
      if (f.path.endsWith('.gz') && /gzip/.test(r.headers.get('content-encoding') ?? '')) blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob()
      if (f.path === 'index.html') blob = new Blob([standalonePage(await blob.text())], { type: 'text/html' })
      entries.push({ name: `${folder}/${f.path}`, blob })
      progress((done += f.size), total)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  entries.sort((a, b) => a.name.localeCompare(b.name))
  entries.push(
    { name: `${folder}/NOTICE.txt`, blob: new Blob([notice(app, build)]) },
    { name: `${folder}/README.txt`, blob: new Blob([README(name, app.isolated)]) },
  )
  download(`${folder}-standalone.zip`, await zip(entries))
}

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
  for (const { name, blob, mode = 0o644 } of entries) {
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
    dir.setUint16(4, (3 << 8) | 20, true) // made on Unix: external attributes hold the file mode
    dir.setUint16(6, 20, true)
    dir.setUint16(8, 0x0800, true)
    dir.setUint16(12, time, true)
    dir.setUint16(14, date, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, blob.size, true)
    dir.setUint32(24, blob.size, true)
    dir.setUint16(28, n.length, true)
    dir.setUint32(38, ((0o100000 | mode) << 16) >>> 0, true)
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
const FILES = (name) => `<script id="playground-standalone">{
  // Opened from the disk, a page can't fetch its own files (the browser treats every file:// page as a separate
  // origin): say what to run instead of failing with errors.
  if (location.protocol === 'file:') {
    addEventListener('DOMContentLoaded', () => { document.documentElement.innerHTML = ${JSON.stringify(`<head><meta charset="utf-8"><title>${name}</title></head><body style="font:16px/1.5 system-ui,sans-serif;max-width:34em;margin:12vh auto;padding:0 1em"><h1>${name} needs a local server</h1><p>Browsers don't let a page opened from the disk load its own files, so this folder has to be served. Run <b>run.sh</b> (macOS, Linux; or <code>python3 serve.py</code>) or <b>run.bat</b> (Windows) in this folder, then open <b>http://localhost:8000/</b> if it doesn't open by itself.</p><p>It needs Python 3 (python.org). README.txt has the details.</p></body>`).replace(/</g, '\\u003c')} })
  }
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
export const standalonePage = (html, name) =>
  html
    .replace(/\s*<link rel="stylesheet" href="\/shell\/shell\.css">/g, '')
    .replace(/\s*<script type="module" src="\/shell\/app\.js"><\/script>/g, '')
    .replace(/<meta charset[^>]*>/i, (m) => `${m}\n  ${FILES(name)}`)

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
${'='.repeat(name.length + 12)}

This folder is the whole app: a page that unzips the .wasm.gz files itself, and the files it loads.

Browsers don't let a page opened from the disk (a file:// address) load its own files, so double-clicking
index.html shows an error. The folder has to be served by a small web server on your own computer. The scripts here
do that for you, and open the app in your browser by themselves. Nothing leaves your machine: the server only listens
on this computer (127.0.0.1).

You need two things:
  1. Python 3, to run the server (steps per system below).
  2. A recent browser: Chrome or Edge (recommended), Firefox or Safari.

First, extract the ZIP completely. Run the scripts from the extracted folder, not from inside the ZIP viewer.

--------------------------------------------------------------------------------------------------------------
WINDOWS
--------------------------------------------------------------------------------------------------------------
Recommended: double-click run.bat. A window opens, the server starts and your browser opens the app. Keep the
window open while you use the app; close it, or press Ctrl+C in it, to stop.

Install Python 3 first, if run.bat says it isn't found:
  - Download the installer from https://www.python.org/downloads/windows/ and run it. On its first screen tick
    "Add python.exe to PATH" (and leave "py launcher" ticked), then choose Install Now.
  - Or install "Python 3" from the Microsoft Store.
  Then double-click run.bat again.

If Windows says "Windows protected your PC" (SmartScreen), choose More info, then Run anyway. run.bat is a few
readable lines: open it in Notepad to see what it does.

If typing "python" in a window opens the Microsoft Store instead, Python isn't installed yet: use one of the two
installs above.

Manual way: open a Command Prompt in this folder and run   py serve.py   then open http://localhost:8000/

--------------------------------------------------------------------------------------------------------------
macOS
--------------------------------------------------------------------------------------------------------------
Recommended: open the Terminal app, type   cd   and a space, drag this folder onto the window, press Return, then run

    sh run.sh

The server starts and your browser opens the app. Press Ctrl+C in Terminal to stop. (./run.sh does the same once
the folder is extracted with its permissions; sh run.sh always works.)

Install Python 3 first, if Terminal says "python3: command not found", or macOS offers to install "command line
developer tools" (that offer is the quickest way, and gives you python3):
  - Accept that offer, or run   xcode-select --install   and wait for it to finish; or
  - download the installer from https://www.python.org/downloads/macos/ and run it; or
  - with Homebrew (https://brew.sh):   brew install python
Then run   sh run.sh   again.

Double-clicking run.sh doesn't start it (macOS opens it in a text editor): use Terminal as above.

Manual way: in Terminal, in this folder, run   python3 serve.py   then open http://localhost:8000/

--------------------------------------------------------------------------------------------------------------
LINUX (and ChromeOS with Linux turned on)
--------------------------------------------------------------------------------------------------------------
Recommended: open a terminal in this folder and run

    sh run.sh

The server starts and your default browser opens the app. Press Ctrl+C to stop. (Your file manager may also run
run.sh if you make it executable: chmod +x run.sh.)

Python 3 is already installed on most distributions. If run.sh says python3 isn't found:
  - Debian, Ubuntu, Mint:   sudo apt install python3
  - Fedora:                 sudo dnf install python3
  - Arch, Manjaro:          sudo pacman -S python
  - openSUSE:               sudo zypper install python3
If no browser opens (no desktop, or ChromeOS Linux), open http://localhost:8000/ in your browser by hand.

Manual way: python3 serve.py   then open http://localhost:8000/

--------------------------------------------------------------------------------------------------------------
ANDROID
--------------------------------------------------------------------------------------------------------------
Nothing on a phone runs run.sh or run.bat by itself, and the easiest way to use ${name} on Android is the
Playground site in Chrome, which needs none of this. To run this copy anyway, you need an app that can run Python:
Termux (a terminal for Android).

  1. Install Termux from F-Droid (https://f-droid.org/packages/com.termux/). F-Droid's is the version its
     developers keep up to date; the Play Store one may be older and behave differently.
  2. Extract this ZIP with your Files app (tap the ZIP, then Extract). Note where the folder ends up, for example
     Downloads.
  3. Open Termux and give it access to your files (a prompt appears; allow it):
         termux-setup-storage
  4. Install Python once:
         pkg install python
  5. Go to the extracted folder (the one that holds serve.py and index.html: use ls to look around; this
     example assumes it is somewhere in Downloads) and start the server:
         cd ~/storage/downloads
         ls
         cd the-folder-that-holds-serve.py
         python serve.py
  6. Open Chrome and go to  http://localhost:8000/   (Termux can't open the browser for you).
     Leave Termux running, in the background (Android may stop it to save battery: allow it to run unrestricted
     in Settings if the app stops responding). To stop, go back to Termux and press Ctrl+C (the CTRL key above
     the keyboard, then C).

Not tested on a device. A phone has far less memory than a computer: big apps may run out of it and Chrome may
close the tab. Chrome or another recent Chromium browser works best.

--------------------------------------------------------------------------------------------------------------
iOS (iPhone) and iPadOS (iPad)
--------------------------------------------------------------------------------------------------------------
iOS and iPadOS can't run run.sh or run.bat, don't let a page in Safari read a folder, and stop apps that run in
the background. The easiest way to use ${name} on an iPhone or iPad is the Playground site in Safari (Share, then
Add to Home Screen), which needs none of this.

To run this copy anyway, you need an app that can run a local web server. a-Shell (free, on the App Store) is a
terminal with Python on iOS and iPadOS:

  1. Install a-Shell from the App Store, and extract this ZIP in the Files app (tap the ZIP).
  2. Open a-Shell. To reach the folder, run   pickFolder   and choose the extracted folder in the list that opens
     (a-Shell remembers it afterwards; see its help for how to cd to it).
  3. In the folder, run   python3 serve.py
  4. On an iPad: put Safari beside a-Shell in Split View or Slide Over, and open  http://localhost:8000/
     On an iPhone: switching to Safari pauses a-Shell, which stops the server; this may not work there at all.
  5. To stop, go back to a-Shell and press Ctrl+C.

Not tested on a device. iOS also limits how much memory a page may use, so big apps may not load, and some need
features older iOS and Safari versions lack.

--------------------------------------------------------------------------------------------------------------
ANY SYSTEM, WITHOUT THE SCRIPTS
--------------------------------------------------------------------------------------------------------------
Any static web server will do, serving this folder: for example   php -S localhost:8000   or   npx serve   .
${isolated ? `This app needs these two response headers from the server (serve.py sends them; most other servers
don't, and the app won't start without them):

    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp
` : 'Nothing special is needed from the server.'}
To use another port (if 8000 is taken):   sh run.sh 9000   or   run.bat 9000   or   python3 serve.py 9000

Open and Save use the browser's own file picker and downloads. What the app saves stays on your computer, in your
Downloads folder, nowhere else.

See NOTICE.txt for the licence.
`

const SERVE = (isolated) => `# Serves this folder at http://localhost:8000/ (or the port given: python3 serve.py 9000) and opens it.
import http.server, sys, webbrowser

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
${isolated ? "        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')\n        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')\n" : ''}        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
with http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler) as server:
    url = f'http://localhost:{port}/'
    print(f'Serving {url} (Ctrl+C to stop)')
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
`
const RUN_SH = '#!/bin/sh\ncd "$(dirname "$0")" && exec python3 serve.py "$@"\n'
const RUN_BAT = '@echo off\r\ncd /d "%~dp0"\r\npy serve.py %* || python serve.py %*\r\npause\r\n'

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
      if (f.path === 'index.html') blob = new Blob([standalonePage(await blob.text(), name)], { type: 'text/html' })
      entries.push({ name: `${folder}/${f.path}`, blob })
      progress((done += f.size), total)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  entries.sort((a, b) => a.name.localeCompare(b.name))
  entries.push(
    { name: `${folder}/NOTICE.txt`, blob: new Blob([notice(app, build)]) },
    { name: `${folder}/README.txt`, blob: new Blob([README(name, app.isolated)]) },
    { name: `${folder}/serve.py`, blob: new Blob([SERVE(app.isolated)]) },
    { name: `${folder}/run.sh`, blob: new Blob([RUN_SH]), mode: 0o755 },
    { name: `${folder}/run.bat`, blob: new Blob([RUN_BAT]) },
  )
  download(`${folder}-standalone.zip`, await zip(entries))
}

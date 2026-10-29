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
    addEventListener('DOMContentLoaded', () => { document.documentElement.innerHTML = ${JSON.stringify(`<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title></head><body style="font:16px/1.5 system-ui,sans-serif;max-width:36em;margin:6vh auto;padding:0 1em"><h1>${name} needs one more step</h1><p>This works on <b>iPhone, iPad, Android, ChromeOS, Windows, macOS and Linux</b>. Browsers don't let a page opened straight from the disk load its own files, so this folder has to be served by a small program on your device. It takes a few minutes the first time.</p><ul><li><b>iPhone and iPad</b> (iOS, iPadOS): install the free <b>a-Shell</b> app, open this folder in it and run <code>python3 serve.py</code></li><li><b>Android</b>: install <b>Termux</b> (from F-Droid) and run <code>python serve.py</code> in this folder</li><li><b>ChromeOS</b>: in the Linux terminal run <code>sh run.sh</code>, or use a web-server extension or Termux</li><li><b>Windows</b>: double-click <b>run.bat</b></li><li><b>macOS and Linux</b>: in a terminal in this folder run <code>sh run.sh</code></li></ul><p>Then open <b>http://localhost:8000/</b> if it doesn't open by itself. <b>README.txt</b> in this folder has every step, system by system.</p></body>`).replace(/</g, '\\u003c')} })
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

WORKS ON: iPhone and iPad (iOS, iPadOS), Android, ChromeOS, Windows, macOS and Linux.
Find your system below. The first time takes a few minutes; after that it is one step.

This folder is the whole app: a page that unzips the .wasm.gz files itself, and the files it loads.

Browsers don't let a page opened straight from the disk (a file:// address) load its own files, so double-clicking
index.html shows a message, not the app. The folder has to be served by a small program on your own device. Nothing
leaves your device: the server only listens on this device (127.0.0.1).

Every system needs two things:
  1. Python 3, to run the server (each section says how to get it).
  2. A recent browser: Chrome or Edge (recommended), Firefox or Safari.

First, extract the ZIP completely. Run everything from the extracted folder, not from inside a ZIP viewer.
The server prints  Serving http://localhost:8000/  and opens your browser when it can. If the browser doesn't open,
open http://localhost:8000/ yourself. Keep the server running while you use the app, and stop it with Ctrl+C.

Sections, in order: iPhone and iPad, Android, ChromeOS, Windows, macOS, Linux.

--------------------------------------------------------------------------------------------------------------
iPHONE and iPAD (iOS and iPadOS)
--------------------------------------------------------------------------------------------------------------
iOS and iPadOS can't run run.sh or run.bat, and they pause apps that run in the background, so this takes a little
care. You need the free a-Shell app (a terminal with Python) from the App Store:

  1. Install a-Shell from the App Store (https://apps.apple.com/app/a-shell/id1473805438).
  2. In the Files app, tap this ZIP to extract it (or extract it in the app you downloaded it with).
  3. Open a-Shell. Run   pickFolder   and choose the extracted folder (the one that holds serve.py and
     index.html). a-Shell asks to access it once; allow it, then it moves you into that folder.
  4. Run   python3 serve.py   and wait for  Serving http://localhost:8000/
  5. Open  http://localhost:8000/  in Safari:
       - iPad: put Safari next to a-Shell in Split View or Slide Over (swipe up from the bottom edge, drag Safari
         beside it). Keep a-Shell visible while you use the app: iPadOS pauses it when it is hidden.
       - iPhone: iOS pauses a-Shell as soon as you leave it, which stops the server. Use the iPhone's
         Picture in Picture or a floating window if your a-Shell version offers one; otherwise this may not work on
         an iPhone.
  6. To stop, go back to a-Shell and press Ctrl+C (the Ctrl key on the keyboard bar, then C).

These steps have not been tested on an iPhone or iPad. iOS also limits how much memory a page may use, so big
apps may not load, and some need a recent iOS or iPadOS version (16 or newer is safest).

--------------------------------------------------------------------------------------------------------------
ANDROID
--------------------------------------------------------------------------------------------------------------
Nothing on Android runs run.sh or run.bat by itself. You need Termux, a free terminal app with Python:

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
     Leave Termux running in the background. If Android stops it to save battery and the app stops responding,
     allow Termux to run unrestricted in Settings, Apps, Termux, Battery.
  7. To stop, go back to Termux and press Ctrl+C (the CTRL key above the keyboard, then C).

These steps have not been tested on a device. A phone has far less memory than a computer: big apps may run out of
it and Chrome may close the tab. Chrome or another recent Chromium browser works best.

--------------------------------------------------------------------------------------------------------------
CHROMEOS (Chromebook, Chromebox, Chromebase)
--------------------------------------------------------------------------------------------------------------
What works depends on how your Chromebook is set up. Use the first method that your device allows.

Method 1, recommended: the Linux terminal
  Needs a Chromebook that supports Linux (most made since 2019) and isn't blocked by a school or company.
  1. Turn Linux on, once: Settings, About ChromeOS (or Advanced), Developers, Linux development environment,
     Turn on, then follow the steps (a few minutes, a few GB of space). Skip this if the Terminal app is already
     in your app list.
  2. Extract the ZIP in the Files app (right-click it, Extract all), then drag the extracted folder into
     "Linux files" in the Files app's left column.
  3. Open the Terminal app. Run:
         cd the-folder-that-holds-serve.py
         sh run.sh
  4. If it says python3 isn't found, run  sudo apt install python3  (answer y), then  sh run.sh  again.
  5. Open Chrome and go to  http://localhost:8000/  if it didn't open by itself. ChromeOS passes localhost from
     Linux to Chrome by itself. Stop with Ctrl+C in Terminal.

Method 2: a web-server extension (no Linux needed)
  For a Chromebook where Linux is blocked but you can install from the Chrome Web Store.
  ${isolated ? `This app needs special server headers (see the end of this guide) that these extensions don't send, so
  this method does NOT work for ${name}: use method 1 or 3.` : `1. Extract the ZIP in the Files app (right-click it, Extract all).
  2. In the Chrome Web Store, search for "Web Server for Chrome" (by 200 OK) and add it. Google has been phasing
     out Chrome apps like this one, so if the store doesn't offer it, or it won't start, use method 1 or 3.
  3. Open it, choose Choose folder, and pick the extracted folder (the one that holds index.html).
  4. Turn on "Web Server: STARTED", then click the address it shows (usually http://127.0.0.1:8887).
  5. To stop, turn the switch off. Keep its window open while you use the app.`}

Method 3: Android apps (Chromebooks with Google Play)
  Install Termux and follow the ANDROID section above (steps 1 to 7; Play Store installs of Termux may be old, so
  if F-Droid's APK won't install, install the F-Droid app first). Then open  http://localhost:8000/  in an
  ANDROID browser (install Chrome or Firefox from Google Play): the ChromeOS browser may not reach an Android
  app's server.

These methods have not been tested on a Chromebook. If you aren't sure which setup you have: if the Terminal app
is in your app list or Settings has a Linux entry, use method 1; if you only have Google Play, use method 3.

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
LINUX
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
If no browser opens (no desktop), open http://localhost:8000/ in your browser by hand.

Manual way: python3 serve.py   then open http://localhost:8000/

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

Open and Save use the browser's own file picker and downloads. What the app saves stays on your device, in your
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
    try:
        webbrowser.open(url)
    except Exception:
        pass
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

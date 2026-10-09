// globalThis.playgroundFonts: the fonts installed on this computer, for the apps' patches (patches/<app>.yaml
// has the Rust side). Chromium-based browsers only (the Local Font Access API, queryLocalFonts, behind the
// one-time "local-fonts" permission); elsewhere supported() is false and the rest does nothing. Loaded on app
// pages by app.js.
//
//   onList(callback)       an app registers once: called with [{family, style, fullName, postscriptName}] as soon
//                          as the fonts are available, at startup when the permission was granted before, else
//                          when request() is granted
//   request()              ask for them, from a font menu opening: the browser's prompt needs the click that
//                          opened it (it counts for ~5 s). Asks once per page; a no-op when unsupported, already
//                          granted or denied, or without a recent click
//   load(postscriptName)   → Promise<Uint8Array>, the font file's bytes (kept: asking again, or twice at once,
//                          reads it once)
//   supported()            the browser has the API
//   granted()              the fonts are available to this page
import { toast } from './ui.js'

const supported = () => typeof globalThis.queryLocalFonts === 'function'

let fonts = null // FontData by PostScript name, once listed
let listing = null
let handler = null
let asked = false
let state = 'prompt'
const loads = new Map()

const deliver = () => fonts && handler?.([...fonts.values()].map(({ family, style, fullName, postscriptName }) => ({ family, style, fullName, postscriptName })))

// Resolves with the number of fonts listed; a denied permission lists none (Chromium answers [], not an error).
function list() {
  listing ??= queryLocalFonts().then(
    (found) => {
      if (found.length) {
        fonts = new Map(found.map((f) => [f.postscriptName, f]))
        deliver()
      } else listing = null
      return found.length
    },
    (e) => {
      listing = null
      throw e
    },
  )
  return listing
}

if (supported()) {
  navigator.permissions
    .query({ name: 'local-fonts' })
    .then((status) => {
      // Allowed later too (at the prompt, or in the site's settings while the page is open).
      const follow = () => (state = status.state) === 'granted' && list()
      status.addEventListener('change', follow)
      return follow()
    })
    .catch((e) => console.warn('playgroundFonts:', e))
}

function request() {
  if (!supported() || asked || state !== 'prompt' || !navigator.userActivation?.isActive) return
  asked = true
  list().then(
    (n) => n && toast('Your fonts are available in this app.'),
    () => {},
  )
}

function load(postscriptName) {
  if (!loads.has(postscriptName)) {
    const font = fonts?.get(postscriptName)
    const bytes = font
      ? font.blob().then((b) => b.arrayBuffer()).then((b) => new Uint8Array(b))
      : Promise.reject(new Error(`playgroundFonts: no font ${postscriptName}`))
    bytes.catch(() => loads.delete(postscriptName))
    loads.set(postscriptName, bytes)
  }
  return loads.get(postscriptName)
}

function onList(callback) {
  handler = callback
  deliver()
}

globalThis.playgroundFonts = Object.freeze({ onList, request, load, supported, granted: () => !!fonts })

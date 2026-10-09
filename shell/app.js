// The shell on an app page (fetch.mjs adds it to each installed app's index.html, before the app's own
// scripts): the browser file storage API (files.js) and the installed fonts (fonts.js) the app's patches
// call, the top bar, and a warning before leaving with work the app may not have saved.
import { savedAt, unsavedReported } from './files.js'
import './fonts.js'
import { pendingWrites } from './store.js'
import { barHidden, mountTopbar } from './topbar.js'

if (barHidden()) document.documentElement.setAttribute('data-pg-bar-hidden', '')

const start = () => mountTopbar().catch((e) => console.error('playground: top bar', e))
if (document.body) start()
else addEventListener('DOMContentLoaded', start, { once: true })

// The shell can't see an app's own "unsaved" state, so: typing or clicking in the app since its last save or
// open counts as unsaved work, unless the app reports its own state (playgroundFiles.setUnsaved), as do store
// writes still in flight.
let lastInput = 0
const inShell = (target) => target instanceof Element && !!target.closest('.pg-bar, .pg-modal, .pg-toasts, .pg-apps, .pg-stack')
for (const type of ['keydown', 'pointerdown']) addEventListener(type, (e) => inShell(e.target) || (lastInput = Date.now()), true)
addEventListener('beforeunload', (e) => {
  const unsaved = unsavedReported() ?? lastInput > savedAt()
  if (pendingWrites() > 0 || unsaved) e.preventDefault()
})

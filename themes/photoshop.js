// PhotoCraft keeps its prefs as JSON in localStorage['photocraft.preferences']; set interface.theme before it
// starts. Dark uses Studio (Dark), its darkest theme (Studio themes also use the Studio panel layout); light
// uses Studio (Light). A user's in-app pick is kept: the marker key records what was last set here, and
// any other theme apart from the app's default (proMedium, written on first run) was chosen in the app.
try {
  const KEY = 'photocraft.preferences', MARKER = 'playground.photocraft.seededTheme'
  const want = matchMedia('(prefers-color-scheme: dark)').matches ? 'studio' : 'studioLight'
  const prefs = JSON.parse(localStorage.getItem(KEY) || '{}')
  const current = prefs.interface?.theme
  if (!current || current === 'proMedium' || current === localStorage.getItem(MARKER)) {
    ;(prefs.interface ||= {}).theme = want
    localStorage.setItem(KEY, JSON.stringify(prefs))
    localStorage.setItem(MARKER, want)
  }
} catch {}

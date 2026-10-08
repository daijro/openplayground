// PrintCraft keeps its prefs as JSON in localStorage['printcraft'] (themes: Light, Dark); set the theme before
// it starts. A user's in-app pick is kept: the marker key records what was last set here, and a stored
// theme that differs from it was chosen in the app.
try {
  const KEY = 'printcraft', MARKER = 'playground.printcraft.seededTheme'
  let prefs
  try { prefs = JSON.parse(localStorage.getItem(KEY)) } catch {}
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) prefs = {}
  const seeded = localStorage.getItem(MARKER)
  if (!prefs.theme || seeded === null || prefs.theme === seeded) {
    prefs.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'Dark' : 'Light'
    localStorage.setItem(KEY, JSON.stringify(prefs))
    localStorage.setItem(MARKER, prefs.theme)
  }
} catch {}

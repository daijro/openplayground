// SolveCraft keeps its prefs as JSON in localStorage['solvecraft.prefs'] (eframe's storage; `dark`: true or
// false, dark by default); set it before the app starts. A user's in-app pick (the toolbar's sun/moon, or
// Preferences) is kept: the marker key records what was last set here, and a stored value that differs from
// it was chosen in the app.
try {
  const KEY = 'solvecraft.prefs', MARKER = 'playground.solvecraft.seededDark'
  let prefs
  try { prefs = JSON.parse(localStorage.getItem(KEY)) } catch {}
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) prefs = {}
  const seeded = localStorage.getItem(MARKER)
  if (typeof prefs.dark !== 'boolean' || seeded === null || String(prefs.dark) === seeded) {
    prefs.dark = matchMedia('(prefers-color-scheme: dark)').matches
    localStorage.setItem(KEY, JSON.stringify(prefs))
    localStorage.setItem(MARKER, String(prefs.dark))
  }
} catch {}

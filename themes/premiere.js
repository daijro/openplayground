// FilmCraft's web build saves no preferences and always starts on Darkest (its darkest theme), so switch to
// Light through its automation API once it has started.
if (!matchMedia('(prefers-color-scheme: dark)').matches) {
  ;(async () => {
    while (!window.filmcraftLoad?.readyMs) {
      if (window.filmcraftLoad?.error) return
      await new Promise((r) => setTimeout(r, 50))
    }
    window.filmcraft.request('ui.set', { theme: 'light' }).catch((e) => console.warn('theme:', e))
  })()
}

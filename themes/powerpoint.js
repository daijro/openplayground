// DeckCraft's web build saves no preferences, has no JS API and always starts Light (it has Light and Dark).
// For dark mode, run its own `view.dark` command through the command palette (Ctrl+Shift+P) once it starts.
if (matchMedia('(prefers-color-scheme: dark)').matches) {
  const frame = () => new Promise((r) => requestAnimationFrame(r))
  const frames = async (n) => { while (n--) await frame() }
  const key = (target, type, k, code, mods = {}) =>
    target.dispatchEvent(new KeyboardEvent(type, { key: k, code, bubbles: true, cancelable: true, ...mods }))
  addEventListener('DOMContentLoaded', async () => {
    const c = document.getElementById('deckcraft_canvas')
    while (document.getElementById('deckcraft_loading')) await frame()
    await frames(30)
    await withInputHeld(async () => {
      c.focus()
      await frames(3)
      const mods = { ctrlKey: true, shiftKey: true }
      key(document.activeElement || document.body, 'keydown', 'P', 'KeyP', mods)
      key(document.activeElement || document.body, 'keyup', 'P', 'KeyP', mods)
      await frames(6)
      const input = document.activeElement
      if (input?.tagName !== 'INPUT') return console.warn('theme: the command palette did not open')
      input.value = 'view.dark'
      input.dispatchEvent(new InputEvent('input', { data: 'view.dark', inputType: 'insertText', bubbles: true }))
      await frames(6)
      key(c, 'keydown', 'Enter', 'Enter')
      key(c, 'keyup', 'Enter', 'Enter')
    })
  })
}

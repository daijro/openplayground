// VectorCraft's web build saves no preferences and has no JS API: it always starts on Medium Dark. Pick its
// own VectorCraft > UI Brightness > Dark (its darkest) or Light with synthetic clicks once it starts.
// ponytail: fixed click positions, verified on v0.4.0 only; other releases are left alone until rechecked.
if (tool.tag === 'v0.4.0') {
  addEventListener('TrunkApplicationStarted', () => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    // Wait in rendered frames (eframe paints in rAF), with a floor in ms, so slow devices keep up.
    const step = (n, ms = 120) => new Promise((r) => setTimeout(() => { const f = () => (--n > 0 ? requestAnimationFrame(f) : r()); requestAnimationFrame(f) }, ms))
    const c = document.getElementById('vectorcraft_canvas')
    const ev = (type, x, y, buttons = 0) =>
      c.dispatchEvent(new (type === 'mousemove' ? MouseEvent : PointerEvent)(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
    const click = async (x, y) => { ev('mousemove', x, y); await step(2); ev('pointerdown', x, y, 1); await step(2); ev('pointerup', x, y); await step(3) }
    const go = async () => {
      // The submenu opens right of the menu, or below its row when the viewport is under 533px.
      const [x, y] = innerWidth >= 533 ? [Math.min(420, innerWidth - 60), 191] : [150, 238]
      await click(106, 21) // VectorCraft menu
      ev('mousemove', 150, 191); await step(4, 300) // hover UI Brightness
      ev('mousemove', x, y); await step(2) // into the submenu
      await click(x, dark ? y : y + 87) // Dark (1st item) / Light (4th item)
    }
    // The page removes #vectorcraft_loading once the app has started.
    const t = setInterval(() => { if (!document.getElementById('vectorcraft_loading')) { clearInterval(t); step(3, 300).then(go) } }, 100)
  })
}

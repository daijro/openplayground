// GridCraft's web build saves no preferences, has no JS API and always starts Light (it has Light and Dark).
// For dark mode, click its own View > Dark Mode checkbox once it starts, then go back to the Home tab.
// ponytail: fixed click positions, verified on v0.1.0 only; other releases are left alone until rechecked.
if (tool.tag === 'v0.1.0' && matchMedia('(prefers-color-scheme: dark)').matches) {
  const frame = () => new Promise((r) => requestAnimationFrame(r))
  const frames = async (n) => { while (n--) await frame() }
  addEventListener('DOMContentLoaded', async () => {
    const c = document.getElementById('gridcraft_canvas')
    while (document.getElementById('gridcraft_loading')) await frame() // removed once the app has started
    await frames(30)
    await withInputHeld(async () => {
      for (const [x, y] of [[514, 53], [537, 89], [47, 53]]) { // View tab, Dark Mode, Home tab
        const r = c.getBoundingClientRect()
        const o = { clientX: r.left + x, clientY: r.top + y, bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }
        c.dispatchEvent(new MouseEvent('mousemove', o)); await frames(3)
        c.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: 1 })); await frames(3)
        c.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); await frames(6)
      }
    })
  })
}

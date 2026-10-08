// WordCraft's web build saves no preferences, has no JS API and always starts Light (it has Light and Dark).
// For dark mode, click its own View > Dark Mode > Switch Modes once it handles input, then go back to Home.
// ponytail: fixed click positions, verified on v0.1.0 only (and viewports >= 900px wide, where the button is
// on screen); other releases are left alone until rechecked.
if (tool.tag === 'v0.1.0' && innerWidth >= 900 && matchMedia('(prefers-color-scheme: dark)').matches) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // eframe reads movement from mousemove and buttons from pointerdown/pointerup.
  const send = (type, x, y) =>
    document.getElementById('wordcraft_canvas')?.dispatchEvent(
      new (type === 'mousemove' ? MouseEvent : PointerEvent)(type, {
        clientX: x, clientY: y, bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: type === 'pointerdown' ? 1 : 0,
      }),
    )
  const tap = async (x, y) => { send('mousemove', x, y); await sleep(80); send('pointerdown', x, y); await sleep(80); send('pointerup', x, y); await sleep(250) }
  ;(async () => {
    // Ready once egui handles input: hovering the document shows the text cursor. Give up after ~60s.
    for (let i = 0; ; i++) {
      if (i > 300) return
      send('mousemove', innerWidth / 2, innerHeight / 2)
      await sleep(200)
      if (document.getElementById('wordcraft_canvas')?.style.cursor === 'text') break
    }
    await withInputHeld(async () => {
      await tap(575, 53) // View tab
      await tap(842, 105) // Dark Mode > Switch Modes
      await tap(75, 53) // Home tab
    })
  })()
}

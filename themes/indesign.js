// DesignCraft's web build saves no preferences and has no JS API: it always starts on Medium Dark. Pick
// Window > Interface Color Theme > Dark (its darkest regular theme) or Light with synthetic clicks, on a
// briefly hidden 1280x800 canvas (narrow layouts cover the Window menu).
// ponytail: fixed click positions, verified on v0.2.1 only; other releases are left alone until rechecked.
if (tool.tag === 'v0.2.1') {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  // egui swaps to its unstyled default look if the OS theme flips while it runs: pin what it sees to dark.
  const realMatchMedia = matchMedia.bind(window)
  window.matchMedia = (q) =>
    /prefers-color-scheme/.test(q)
      ? { media: q, matches: /dark/.test(q), onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
      : realMatchMedia(q)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  addEventListener('TrunkApplicationStarted', async () => {
    const c = document.getElementById('designcraft_canvas')
    const dx = Math.min(0, innerWidth - 700) // keep the menu (x 374..640) inside the viewport
    const ev = (type, x, y) =>
      c.dispatchEvent(new (type === 'mousemove' ? MouseEvent : PointerEvent)(type, { clientX: x + dx, clientY: y, button: 0, bubbles: true, isPrimary: true, pointerType: 'mouse' }))
    const click = async (x, y) => { ev('mousemove', x, y); await sleep(50); ev('pointerdown', x, y); await sleep(50); ev('pointerup', x, y); await sleep(150) }
    c.style.cssText = `opacity:0;width:1280px;height:800px;left:${dx}px`
    for (let i = 0; document.getElementById('designcraft_loading'); i++) {
      if (i > 600) return void (c.style.cssText = '') // failed to start: leave the error visible
      await sleep(50)
    }
    await sleep(400)
    await click(374, 17) // Window
    ev('mousemove', 380, 418); await sleep(150); ev('mousemove', 420, 418); await sleep(300) // Interface Color Theme >
    await click(640, dark ? 418 : 493) // Dark | Light
    c.dispatchEvent(new MouseEvent('mouseleave'))
    c.style.cssText = ''
  })
}

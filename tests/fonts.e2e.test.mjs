// Illustrator with the computer's installed fonts (patches/illustrator.yaml rules 1–11, shell/fonts.js), end to
// end: our patched build (installed by `make fetch` from out/ or the builds release) on the real GPU, the
// fonts this machine has (Comic Sans MS and Impact are assumed installed). Opt in:
//   E2E=1 node --test tests/fonts.e2e.test.mjs         (SHOTS=<dir> also saves screenshots there)
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { GPU, launch, openPage, startSite, until } from './helpers.mjs'

const E2E = process.env.E2E === '1'
let site, browser, url
before(async () => {
  if (!E2E) return
  site = await startSite()
  browser = await launch(GPU)
  const apps = (await (await fetch(`${site.url}/shell/apps.json`)).json()).groups.flatMap((g) => g.apps)
  const app = apps.find((a) => a.slug === 'illustrator')
  // WebGL: headless WebGPU is unreliable.
  url = `${site.url}${(app.release ?? app.head).path}?webgl`
})
after(async () => {
  await browser?.close()
  await site?.close()
})

// Where things are in a 1400×900 window (Essentials workspace): the Welcome screen's Letter, the Type tool, the
// Properties panel's font family menu and font size.
const LETTER = [220, 410]
const TYPE_TOOL = [26, 671]
const FONT_MENU = [1248, 353]
const FONT_SIZE = [1190, 417]
const TEXT = { x: 330, y: 230, width: 480, height: 160 }

// Records each queryLocalFonts call (and whether a click still counted then) and each font file read.
const watch = () => {
  globalThis.asked = []
  globalThis.read = []
  const query = globalThis.queryLocalFonts
  globalThis.queryLocalFonts = async function () {
    asked.push(navigator.userActivation.isActive)
    const fonts = await query.apply(this, arguments)
    for (const f of fonts) {
      const blob = f.blob.bind(f)
      f.blob = () => (read.push(f.postscriptName), blob())
    }
    return fonts
  }
}

async function illustrator({ grant, init = watch }) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' })
  if (grant) await context.grantPermissions(['local-fonts'])
  await context.addInitScript(init)
  const page = await openPage(browser, url, { context })
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  page.on('console', (m) => /panicked/.test(m.text()) && page.errors.push(m.text()))
  await page.waitForFunction(() => !document.querySelector('[id$="_loading"]'), null, { timeout: 120_000 })
  await page.waitForTimeout(2500)
  return page
}

const shot = (page, name) => page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/${name}.png` : undefined })
const textPixels = (page) => page.screenshot({ clip: TEXT })

// A new Letter document with "Handgloves" in 72 pt point type, selected.
async function typeText(page) {
  await page.mouse.click(...LETTER)
  await page.waitForTimeout(1500)
  await page.mouse.click(...TYPE_TOOL)
  await page.mouse.click(350, 330)
  await page.keyboard.type('Handgloves', { delay: 20 })
  await page.keyboard.press('Escape')
  await page.mouse.click(...FONT_SIZE, { clickCount: 3 })
  await page.keyboard.type('72')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
}

test('opening the font menu asks for the fonts, while the click that opened it counts', { skip: !E2E }, async () => {
  const page = await illustrator({ grant: false })
  await typeText(page)
  // Playwright's own calls count as clicks for ~5 s: let them lapse, so only the menu's click counts.
  await page.waitForTimeout(5500)
  assert.deepEqual(await page.evaluate(() => asked), [], 'not asked at startup')
  await page.mouse.click(...FONT_MENU)
  await until(() => page.evaluate(() => asked.length), 5000, 'the request')
  assert.deepEqual(await page.evaluate(() => asked), [true])
  // Headless Chromium answers with Block: the menu keeps the bundled fonts, and isn't asked again.
  await page.keyboard.press('Escape')
  await page.mouse.click(...FONT_MENU)
  await page.waitForTimeout(800)
  assert.equal((await page.evaluate(() => asked)).length, 1)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('allowed before: the font menu lists the installed families, and type set in one draws in it', { skip: !E2E }, async () => {
  const page = await illustrator({ grant: true })
  assert.deepEqual(await page.evaluate(() => asked), [false], 'listed at startup, unasked')
  await typeText(page)
  const before = await textPixels(page)
  await shot(page, 'type-before')
  await page.mouse.click(...FONT_MENU)
  await page.waitForTimeout(800)
  await page.keyboard.type('Comic Sans', { delay: 20 })
  await page.waitForTimeout(800)
  await shot(page, 'font-menu')
  await page.keyboard.press('Enter')
  await until(() => page.evaluate(() => read.includes('ComicSansMS')), 10_000, 'Comic Sans MS to be read')
  await page.waitForTimeout(1500)
  await shot(page, 'type-after')
  assert.notDeepEqual(await textPixels(page), before, 'drawn in Comic Sans MS')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('a document naming an installed font draws in it once the font is read', { skip: !E2E }, async () => {
  const page = await illustrator({ grant: true })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300">
    <rect width="600" height="300" fill="#fff"/>
    <text x="30" y="120" font-family="Impact" font-size="90" fill="#c03">Impact 123</text>
    <text x="30" y="240" font-family="'Comic Sans MS', cursive" font-size="70" fill="#036">Comic Sans</text>
  </svg>`
  await page.evaluate((svg) => {
    const canvas = document.querySelector('canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File([svg], 'fonts.svg', { type: 'image/svg+xml' }))
    const r = canvas.getBoundingClientRect()
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, dataTransfer }
    for (const type of ['dragenter', 'dragover', 'drop']) canvas.dispatchEvent(new DragEvent(type, at))
  }, svg)
  await until(async () => {
    const read = await page.evaluate(() => read)
    return read.includes('Impact') && read.includes('ComicSansMS')
  }, 15_000, 'Impact and Comic Sans MS to be read')
  await page.waitForTimeout(1500)
  await shot(page, 'document')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('without the Local Font Access API: the font menu has the bundled fonts, and nothing breaks', { skip: !E2E }, async () => {
  const page = await illustrator({
    grant: true,
    init: () => {
      delete globalThis.queryLocalFonts
      delete Window.prototype.queryLocalFonts
    },
  })
  await typeText(page)
  const before = await textPixels(page)
  await page.mouse.click(...FONT_MENU)
  await page.waitForTimeout(800)
  await page.keyboard.type('Source Serif', { delay: 20 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)
  assert.notDeepEqual(await textPixels(page), before, 'a bundled font still applies')
  assert.equal(await page.locator('.pg-toast').count(), 0)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

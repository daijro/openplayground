// playgroundFonts (shell/fonts.js) on an app page: the installed fonts through the Local Font Access API.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { launch, openPage, startSite, until } from './helpers.mjs'

let site, browser, url
before(async () => {
  site = await startSite()
  browser = await launch()
  const apps = (await (await fetch(`${site.url}/shell/apps.json`)).json()).groups.flatMap((g) => g.apps)
  const word = apps.find((a) => a.slug === 'word')
  url = `${site.url}${(word.release ?? word.head).path}`
})
after(async () => {
  await browser?.close()
  await site?.close()
})

/** A page in a fresh profile, with `init` run before the page's scripts; page errors collected in page.errors. */
async function fontsPage({ grant = false, init } = {}) {
  const context = await browser.newContext()
  if (grant) await context.grantPermissions(['local-fonts'])
  if (init) await context.addInitScript(init)
  const errors = []
  context.on('weberror', (e) => errors.push(e.error().message))
  const page = await openPage(browser, url, { context })
  page.errors = errors
  await page.locator('.pg-bar').waitFor()
  return page
}

test('allowed on an earlier visit: onList gets the fonts at startup, unasked, and load reads their files once', async () => {
  const page = await fontsPage({ grant: true })
  const fonts = await page.evaluate(() => new Promise((resolve) => playgroundFonts.onList(resolve)))
  assert.ok(fonts.length > 0, 'this machine has fontconfig fonts')
  assert.deepEqual(Object.keys(fonts[0]).sort(), ['family', 'fullName', 'postscriptName', 'style'])
  const font = fonts.find((f) => f.family === 'DejaVu Serif' && f.style === 'Book') ?? fonts[0]
  const read = await page.evaluate(async (name) => {
    const [a, b] = [playgroundFonts.load(name), playgroundFonts.load(name)]
    const bytes = await a
    return { same: a === b, again: (await playgroundFonts.load(name)) === bytes, size: bytes.length, head: [...bytes.slice(0, 4)] }
  }, font.postscriptName)
  assert.ok(read.same && read.again, 'one read per font')
  assert.ok(read.size > 1000)
  assert.ok([[0, 1, 0, 0], [0x4f, 0x54, 0x54, 0x4f], [0x74, 0x74, 0x63, 0x66]].some((h) => h.join() === read.head.join()), 'a TrueType/OpenType file or collection')
  assert.equal(await page.evaluate(() => playgroundFonts.supported() && playgroundFonts.granted()), true)
  assert.equal(await page.locator('.pg-toast').count(), 0, 'no notice for fonts allowed before')
  await assert.rejects(page.evaluate(() => playgroundFonts.load('No-Such-Font')))
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('not asked yet: request() two frames after a click asks the browser, once per page', async () => {
  // A font menu opening: the click that opened it reaches request() a frame or two later (from the app's
  // wasm). Headless Chromium answers the prompt with Block.
  const page = await fontsPage({
    init: () => {
      const query = globalThis.queryLocalFonts
      globalThis.asked = []
      globalThis.queryLocalFonts = function () {
        asked.push(navigator.userActivation.isActive)
        return query.apply(this, arguments)
      }
      addEventListener('pointerup', () => requestAnimationFrame(() => requestAnimationFrame(() => playgroundFonts.request())), true)
    },
  })
  assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: 'local-fonts' })).state), 'prompt')
  // Playwright's evaluate counts as a click: let that lapse (~5 s), so only the real click below counts.
  await page.waitForTimeout(5500)
  await page.mouse.click(400, 300)
  await page.waitForTimeout(1000)
  assert.deepEqual(await page.evaluate(() => asked), [true], 'asked while the click still counted')
  assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: 'local-fonts' })).state), 'denied', 'the browser prompted')
  await page.mouse.click(400, 300)
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => asked.length), 1, 'not asked again')
  assert.equal(await page.evaluate(() => playgroundFonts.granted()), false)
  assert.equal(await page.locator('.pg-toast').count(), 0, 'nothing said when refused')
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

test('allowed at the prompt: onList gets the fonts and a notice says so', async () => {
  // The prompt answered with Allow (headless Chromium can't show it): queryLocalFonts lists a font.
  const page = await fontsPage({
    init: () => {
      const bytes = new Uint8Array([0, 1, 0, 0, 9])
      globalThis.queryLocalFonts = async () => [{ family: 'Test Sans', style: 'Regular', fullName: 'Test Sans', postscriptName: 'TestSans-Regular', blob: async () => new Blob([bytes]) }]
    },
  })
  await page.evaluate(() => playgroundFonts.onList((fonts) => (globalThis.listed = fonts)))
  await page.evaluate(() => playgroundFonts.request())
  assert.deepEqual(await until(() => page.evaluate(() => globalThis.listed), 5000, 'the list'), [
    { family: 'Test Sans', style: 'Regular', fullName: 'Test Sans', postscriptName: 'TestSans-Regular' },
  ])
  await page.getByText('Your fonts are available in this app.').waitFor()
  assert.deepEqual(await page.evaluate(async () => [...(await playgroundFonts.load('TestSans-Regular'))]), [0, 1, 0, 0, 9])
  await page.context().close()
})

test('allowed in the site settings while the page is open: the fonts arrive without a reload', async () => {
  const page = await fontsPage()
  await page.evaluate(() => playgroundFonts.onList((fonts) => (globalThis.listed = fonts.length)))
  await page.context().grantPermissions(['local-fonts'])
  assert.ok(await until(() => page.evaluate(() => globalThis.listed), 5000, 'the list'))
  await page.context().close()
})

test('without the Local Font Access API (Firefox, Safari): nothing shows and nothing throws', async () => {
  const page = await fontsPage({
    grant: true,
    init: () => {
      delete globalThis.queryLocalFonts
      delete Window.prototype.queryLocalFonts
    },
  })
  const result = await page.evaluate(async () => {
    let listed = false
    playgroundFonts.onList(() => (listed = true))
    playgroundFonts.request()
    const load = await playgroundFonts.load('DejaVuSerif').then(() => 'loaded', () => 'rejected')
    await new Promise((r) => setTimeout(r, 300))
    return { supported: playgroundFonts.supported(), granted: playgroundFonts.granted(), listed, load }
  })
  assert.deepEqual(result, { supported: false, granted: false, listed: false, load: 'rejected' })
  assert.equal(await page.locator('.pg-toast').count(), 0)
  assert.deepEqual(page.errors, [])
  await page.context().close()
})

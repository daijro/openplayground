// Runs against the exact NoteCraft web build made by scripts/build.mjs. This catches WASM panics that a successful
// `cargo check` cannot see: in particular, std::time calls that compile but panic on wasm32-unknown-unknown.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { launch, startStaticSite, until } from './helpers.mjs'

const dist = process.env.NOTECRAFT_WEB_DIST
const url = process.env.NOTECRAFT_URL
let site, browser

before(async () => {
  if (!dist && !url) return
  site = dist ? await startStaticSite(dist) : { url }
  browser = await launch([
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--disable-vulkan-surface',
  ])
})

after(async () => {
  await browser?.close()
  await site?.close?.()
})

test('NoteCraft starts in Chromium without a WASM panic', { skip: !dist && !url, timeout: 120_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const failures = []
  const diagnostics = []
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') diagnostics.push(`${message.type()}: ${message.text()}`)
    if (message.type() === 'error' || /panicked at|RuntimeError: unreachable/i.test(message.text())) failures.push(message.text())
  })
  page.on('requestfailed', (request) => diagnostics.push(`request failed: ${request.url()} (${request.failure()?.errorText})`))

  await page.goto(site.url, { waitUntil: 'networkidle' })
  try {
    await until(() => page.evaluate(() => {
      const loading = document.querySelector('#notecraft_loading')
      return !loading || /could not start/i.test(loading.textContent ?? '')
    }), 60_000, 'NoteCraft startup to finish')
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '(page body unavailable)')
    assert.fail(`${error.message}\nbody: ${body}\npage errors: ${failures.join('\n')}\nbrowser diagnostics: ${diagnostics.join('\n')}`)
  }

  // Give async WebGPU startup callbacks time to run; the time panic has occurred after adapter requests.
  await page.waitForTimeout(5_000)
  assert.deepEqual(failures, [], `the browser must not report a Rust panic or page error; diagnostics: ${diagnostics.join('\n')}`)
  const startupError = await page.locator('#notecraft_loading').textContent().catch(() => null)
  assert.equal(startupError, null, startupError ?? 'the loading message should be removed after startup')
  assert.equal(await page.evaluate(() => Boolean(window.wasmBindings)), true, 'the WASM module should initialize')
  assert.deepEqual(await page.locator('#notecraft_canvas').evaluate((canvas) => [canvas.width, canvas.height]), [1280, 800])
  await page.close()
})

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { launch, openPage, startSite } from './helpers.mjs'

let site, browser, apps
before(async () => {
  site = await startSite()
  browser = await launch()
  apps = (await (await fetch(`${site.url}/shell/apps.json`)).json()).groups.flatMap((g) => g.apps)
})
after(async () => {
  await browser?.close()
  await site?.close()
})

const wordPath = () => {
  const word = apps.find((a) => a.slug === 'word')
  return (word.release ?? word.head).path
}

test('the bar sits above the app, and the app canvas starts below it', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  const bar = page.locator('.pg-bar')
  await bar.waitFor()
  assert.equal((await bar.boundingBox()).height, 36)
  const canvas = await page.locator('body > canvas').first().boundingBox()
  assert.equal(canvas.y, 36)
  assert.equal(canvas.height, page.viewportSize().height - 36)
})

test('the switcher lists every installed app and links to each one', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  await page.getByRole('button', { name: /Word/ }).click()
  const items = page.getByRole('menuitem')
  await items.first().waitFor()
  assert.equal(await items.count(), apps.length)
  const excel = apps.find((a) => a.slug === 'excel')
  assert.equal(await page.getByRole('menuitem', { name: /Excel/ }).getAttribute('href'), (excel.release ?? excel.head).path)
  assert.equal(await page.getByRole('menuitem', { name: /Word/ }).getAttribute('aria-current'), 'page')
})

test('with "Use latest commits" on, the switcher links to latest-commit builds', async () => {
  const context = await browser.newContext()
  await context.addInitScript(() => localStorage.setItem('channel', 'head'))
  const page = await openPage(browser, `${site.url}${wordPath()}`, { context })
  await page.getByRole('button', { name: /Word/ }).click()
  for (const app of apps.filter((a) => a.head)) {
    assert.equal(await page.getByRole('menuitem', { name: new RegExp(app.name) }).getAttribute('href'), app.head.path)
  }
  await context.close()
})

test('the version shows this build’s label', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  const word = apps.find((a) => a.slug === 'word')
  const build = word.release ?? word.head
  assert.match(await page.locator('.pg-version').textContent(), new RegExp(build.label.replace(/[.@]/g, '\\$&')))
})

test('Files opens the explorer popup and Esc closes it', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  await page.getByRole('button', { name: 'Files' }).click()
  await page.getByRole('dialog', { name: 'Files' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Files' }).waitFor({ state: 'detached' })
})

test('fullscreen gives the app the whole screen: the bar steps aside until fullscreen ends', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  await page.getByRole('button', { name: 'Fullscreen' }).click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  assert.equal(await page.locator('.pg-bar').isVisible(), false)
  assert.equal((await page.locator('body > canvas').first().boundingBox()).y, 0)
  await page.evaluate(() => document.exitFullscreen()) // what Esc does
  await page.waitForFunction(() => !document.fullscreenElement)
  await page.locator('.pg-bar').waitFor()
  assert.equal((await page.locator('body > canvas').first().boundingBox()).y, 36)
})

test('without the app list, the bar still has Files and Fullscreen', async () => {
  const context = await browser.newContext()
  await context.route('**/shell/apps.json', (r) => r.abort())
  const page = await openPage(browser, `${site.url}${wordPath()}`, { context })
  await page.locator('.pg-bar').waitFor()
  await page.getByRole('button', { name: 'Fullscreen' }).waitFor()
  await page.getByRole('button', { name: 'Files' }).click()
  await page.getByRole('dialog', { name: 'Files' }).waitFor()
  assert.equal(await page.locator('.pg-switch').count(), 0)
  await context.close()
})

test('leaving after working in the app asks first', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  await page.locator('.pg-bar').waitFor()
  await page.mouse.click(400, 300)
  await page.keyboard.press('a')
  const dialog = new Promise((resolve) => page.once('dialog', resolve))
  await page.close({ runBeforeUnload: true })
  const shown = await dialog
  assert.equal(shown.type(), 'beforeunload')
  await shown.accept()
})

test('an app that reports its own state is warned about only when it has unsaved changes', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  await page.locator('.pg-bar').waitFor()
  await page.mouse.click(400, 300)
  await page.keyboard.press('a')
  await page.evaluate(() => playgroundFiles.setUnsaved(false)) // the app says: nothing unsaved
  let asked = false
  page.on('dialog', (d) => ((asked = true), d.accept()))
  await page.close({ runBeforeUnload: true })
  await new Promise((r) => setTimeout(r, 500))
  assert.equal(asked, false, 'warned although the app reported no unsaved changes')

  const second = await openPage(browser, `${site.url}${wordPath()}`)
  await second.locator('.pg-bar').waitFor()
  await second.mouse.click(400, 300) // gives the page the user activation a beforeunload prompt needs
  await second.evaluate(() => playgroundFiles.setUnsaved(true))
  const dialog = new Promise((resolve) => second.once('dialog', resolve))
  await second.close({ runBeforeUnload: true })
  const shown = await dialog
  assert.equal(shown.type(), 'beforeunload')
  await shown.accept()
})

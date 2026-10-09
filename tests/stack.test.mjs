import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { launch, openPage, startSite, until } from './helpers.mjs'

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

const pathOf = (slug) => {
  const app = apps.find((a) => a.slug === slug)
  return (app.release ?? app.head).path
}
const stat = (page, path) => page.evaluate(async (p) => (await import('/shell/store.js')).stat(p), path)

// A Word page whose browser storage holds `names`, written in order (so the last is the most recent).
async function wordWith(names) {
  const context = await browser.newContext()
  const seed = await openPage(browser, `${site.url}/shell/paths.js`, { context })
  await seed.evaluate(async (list) => {
    const store = await import('/shell/store.js')
    for (const name of list) {
      await store.write(`/${name}`, new Uint8Array([1, 2, 3]))
      await new Promise((r) => setTimeout(r, 20)) // distinct modified times
    }
  }, names)
  const page = await openPage(browser, `${site.url}${pathOf('word')}`, { context })
  await page.locator('.pg-bar').waitFor()
  return page
}
const fan = (page) => page.getByRole('menu', { name: 'Recent files' })

test('Files fans out the ten most recent files, newest nearest the bar, then Open Files', async () => {
  const names = Array.from({ length: 12 }, (_, i) => `file${String(i).padStart(2, '0')}.docx`)
  const page = await wordWith(names)
  await page.getByRole('button', { name: 'Files' }).click()
  const items = fan(page).getByRole('menuitem')
  await items.first().waitFor()
  const labels = await items.allTextContents()
  assert.deepEqual(labels, [...names.slice(2).reverse(), 'Open Files'])
  const word = apps.find((a) => a.slug === 'word')
  assert.equal(await items.first().locator('img').getAttribute('src'), word.icon)
  // The fan curves out: each item sits lower and further left than the one before.
  const boxes = await Promise.all([0, 4, 9].map((i) => items.nth(i).boundingBox()))
  assert.ok(boxes[0].y < boxes[1].y && boxes[1].y < boxes[2].y, 'items go down')
  assert.ok(boxes[0].x + boxes[0].width > boxes[2].x + boxes[2].width, 'and curve to the left')
})

test('clicking a file opens it in its app', async () => {
  const page = await wordWith(['budget.xlsx'])
  await page.getByRole('button', { name: 'Files' }).click()
  await fan(page).getByRole('menuitem', { name: 'budget.xlsx' }).click()
  await page.waitForURL((url) => url.pathname === pathOf('excel') && url.searchParams.get('open') === 'browser:/budget.xlsx')
})

test('right-clicking a file offers its apps and actions; Rename edits the name in place', async () => {
  const page = await wordWith(['shot.png'])
  await page.getByRole('button', { name: 'Files' }).click()
  await fan(page).getByRole('menuitem', { name: 'shot.png' }).click({ button: 'right' })
  const menu = page.locator('.pg-menu')
  await menu.getByRole('menuitem', { name: 'Open in Photoshop' }).waitFor()
  for (const action of ['Download', 'Rename', 'Delete']) await menu.getByRole('menuitem', { name: action }).waitFor()
  await menu.getByRole('menuitem', { name: 'Rename' }).click()
  const field = page.getByLabel('New name for shot.png')
  await field.fill('screenshot.png')
  await field.press('Enter')
  await until(() => stat(page, '/screenshot.png'), 5000, 'the rename')
  assert.equal(await stat(page, '/shot.png'), null)
  await fan(page).getByRole('menuitem', { name: 'screenshot.png' }).waitFor()
})

test('Delete from the fan asks first', async () => {
  const page = await wordWith(['old.docx'])
  await page.getByRole('button', { name: 'Files' }).click()
  await fan(page).getByRole('menuitem', { name: 'old.docx' }).click({ button: 'right' })
  await page.locator('.pg-menu').getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await until(async () => (await stat(page, '/old.docx')) === null, 5000, 'the delete')
})

test('Esc, a click outside and the Files button close the fan', async () => {
  const page = await wordWith(['a.docx'])
  const button = page.getByRole('button', { name: 'Files' })
  await button.click()
  await fan(page).waitFor()
  assert.equal(await button.getAttribute('aria-expanded'), 'true')
  await page.keyboard.press('Escape')
  await fan(page).waitFor({ state: 'detached' })
  await button.click()
  await fan(page).waitFor()
  await page.mouse.click(200, 500)
  await fan(page).waitFor({ state: 'detached' })
  await button.click()
  await fan(page).waitFor()
  await button.click()
  await fan(page).waitFor({ state: 'detached' })
  assert.equal(await button.getAttribute('aria-expanded'), 'false')
})

test('with no files the fan says so and still offers Open Files', async () => {
  const page = await wordWith([])
  await page.getByRole('button', { name: 'Files' }).click()
  await fan(page).getByText('No files yet').waitFor()
  await fan(page).getByRole('menuitem', { name: 'Open Files' }).waitFor()
})

test('keys typed in the fan stay out of the app', async () => {
  const page = await wordWith(['a.docx'])
  await page.evaluate(() => {
    window.leaked = 0
    document.addEventListener('keydown', () => window.leaked++)
  })
  await page.getByRole('button', { name: 'Files' }).click()
  await fan(page).getByRole('menuitem', { name: 'a.docx' }).waitFor()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  assert.equal(await page.evaluate(() => window.leaked), 0)
})

test('dragging a file out of the fan drops it on the app as a file', async () => {
  const page = await wordWith(['note.txt'])
  await page.evaluate(() => {
    window.dropped = null
    document.addEventListener('drop', (e) => (window.dropped = { files: [...e.dataTransfer.files].map((f) => [f.name, f.size]), on: e.target.tagName }), true)
  })
  await page.getByRole('button', { name: 'Files' }).click()
  const item = fan(page).getByRole('menuitem', { name: 'note.txt' })
  await item.waitFor()
  await page.waitForTimeout(700) // let the spring settle
  // A person's drag: press on the item, move onto the app (the fan steps aside once the drag starts), release.
  const from = await item.boundingBox()
  await page.mouse.move(from.x + from.width - 20, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(500, 420, { steps: 8 })
  await page.mouse.move(400, 336, { steps: 8 })
  await page.mouse.up()
  const dropped = await until(() => page.evaluate(() => window.dropped), 5000, 'the drop')
  assert.deepEqual(dropped, { files: [['note.txt', 3]], on: 'CANVAS' })
  await fan(page).waitFor({ state: 'detached' })
})

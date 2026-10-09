import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { launch, openPage, startSite, until } from './helpers.mjs'

let site, browser
before(async () => {
  site = await startSite()
  browser = await launch()
})
after(async () => {
  await browser?.close()
  await site?.close()
})

const stat = (page, path) => page.evaluate(async (p) => (await import('/shell/store.js')).stat(p), path)
const row = (page, name) => page.getByRole('option', { name: new RegExp(`^${name.replace(/[.()]/g, '\\$&')}`) })

test('the dashboard links to the Files page', async () => {
  const page = await openPage(browser, `${site.url}/`)
  const link = page.getByRole('link', { name: 'Open Files', exact: true })
  assert.equal(await link.locator('svg').count(), 1, 'the link has a file icon')
  await link.click()
  await page.waitForURL(/\/files\/$/)
  await page.getByRole('listbox', { name: 'Files' }).waitFor()
})

test('one flat list: upload, rename and delete, with no folders anywhere', async () => {
  const page = await openPage(browser, `${site.url}/files/`)
  await page.getByText('No files yet').waitFor()
  assert.equal(await page.getByRole('button', { name: 'New folder' }).count(), 0)
  assert.equal(await page.locator('.pg-crumbs').count(), 0)

  await page.locator('.pg-ex-tools input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await row(page, 'notes.txt').waitFor()
  assert.equal((await stat(page, '/notes.txt')).size, 5)

  await row(page, 'notes.txt').click()
  await page.keyboard.press('F2')
  await page.getByLabel('New name for notes.txt').fill('todo.txt')
  await page.keyboard.press('Enter')
  await row(page, 'todo.txt').waitFor()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.pg-ex-status.pg-error').count(), 0, 'a successful rename shows no error')

  await row(page, 'todo.txt').click()
  await page.keyboard.press('Delete')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await until(async () => (await stat(page, '/todo.txt')) === null, 5000, 'the delete')
})

test('files left in folders from before move up to the one list, renamed on a clash', async () => {
  const context = await browser.newContext()
  const seed = await openPage(browser, `${site.url}/shell/paths.js`, { context })
  await seed.evaluate(async () => {
    const store = await import('/shell/store.js')
    await store.write('/test/a.png', new Uint8Array([1]))
    await store.write('/test/deeper/b.txt', new Uint8Array([2]))
    await store.write('/a.png', new Uint8Array([3]))
  })
  const page = await openPage(browser, `${site.url}/files/`, { context })
  await row(page, 'b.txt').waitFor()
  await row(page, 'a (2).png').waitFor()
  assert.equal(await stat(page, '/test'), null)
  assert.deepEqual([...(await page.evaluate(async () => (await import('/shell/store.js')).read('/a.png')))], [3], 'the file already at the top keeps its name')
  await context.close()
})

test('rename refuses a taken name and an invalid one', async () => {
  const page = await openPage(browser, `${site.url}/files/`)
  await page.evaluate(async () => {
    const store = await import('/shell/store.js')
    await store.write('/a.txt', new Uint8Array([1]))
    await store.write('/b.txt', new Uint8Array([2]))
  })
  await page.reload()
  await row(page, 'a.txt').click()
  await page.keyboard.press('F2')
  await page.getByLabel('New name for a.txt').fill('b.txt')
  await page.keyboard.press('Enter')
  await page.getByText('b.txt already exists.').waitFor()
  await row(page, 'a.txt').click()
  await page.keyboard.press('F2')
  await page.getByLabel('New name for a.txt').fill('a/b')
  await page.keyboard.press('Enter')
  await page.getByText('isn’t a valid name').waitFor()
  assert.ok(await stat(page, '/a.txt'))
})

test('file rows carry the icon of the app that opens them; download works', async () => {
  const page = await openPage(browser, `${site.url}/files/`)
  await page.evaluate(async () => (await import('/shell/store.js')).write('/Budget.xlsx', new Uint8Array([7, 7])))
  await page.reload()
  const icon = row(page, 'Budget.xlsx').locator('img')
  assert.match(await icon.getAttribute('src'), /excel\/site-icon/)
  await row(page, 'Budget.xlsx').getByRole('button', { name: 'Actions for Budget.xlsx' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download' }).click()])
  assert.equal(download.suggestedFilename(), 'Budget.xlsx')
})

test('dropping files from the computer uploads them', async () => {
  const page = await openPage(browser, `${site.url}/files/`)
  await page.getByText('No files yet').waitFor()
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['abc'], 'dropped.txt', { type: 'text/plain' }))
    return dt
  })
  await page.locator('.pg-ex-list').dispatchEvent('dragover', { dataTransfer })
  await page.locator('.pg-ex-list').dispatchEvent('drop', { dataTransfer })
  await until(() => stat(page, '/dropped.txt'), 5000, 'the upload')
})

test('dropping a file on the explorer header uploads it', async () => {
  const page = await openPage(browser, `${site.url}/files/`)
  await page.getByRole('listbox', { name: 'Files' }).waitFor()
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['xyz'], 'header-drop.txt', { type: 'text/plain' }))
    return dt
  })
  await page.locator('.pg-ex-head').dispatchEvent('dragover', { dataTransfer })
  await page.locator('.pg-ex-head').dispatchEvent('drop', { dataTransfer })
  await until(() => stat(page, '/header-drop.txt'), 5000, 'the upload')
})

test('right-clicking a file offers every app that opens its type, each with its icon', async () => {
  const page = await openPage(browser, `${site.url}/files/`)
  const apps = (await (await fetch(`${site.url}/shell/apps.json`)).json()).groups.flatMap((g) => g.apps)
  const expected = [...apps.filter((a) => a.opens.includes('png')), ...apps.filter((a) => !a.opens.includes('png') && a.imports.includes('png'))]
  assert.ok(expected.length >= 2, 'several apps open .png')
  await page.evaluate(async () => (await import('/shell/store.js')).write('/shot.png', new Uint8Array([1])))
  await page.reload()
  await row(page, 'shot.png').click({ button: 'right' })
  const items = page.getByRole('menuitem', { name: /^Open in / })
  assert.deepEqual(await items.allTextContents(), expected.map((a) => `Open in ${a.name}`))
  for (let i = 0; i < expected.length; i++) assert.equal(await items.nth(i).locator('img').getAttribute('src'), expected[i].icon)
  await page.getByRole('menuitem', { name: 'Download' }).waitFor()
})

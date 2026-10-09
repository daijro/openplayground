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

test('new folder, upload, rename, move by dragging, delete', async () => {
  const page = await openPage(browser, `${site.url}/files/`)
  await page.getByText('This folder is empty').waitFor()

  await page.getByRole('button', { name: 'New folder' }).click()
  const field = page.getByLabel('New name for New folder')
  await field.fill('Reports')
  await field.press('Enter')
  await row(page, 'Reports').waitFor()

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

  await row(page, 'todo.txt').dragTo(row(page, 'Reports'))
  await until(() => stat(page, '/Reports/todo.txt'), 5000, 'the move')
  assert.equal(await stat(page, '/todo.txt'), null)
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.pg-ex-status.pg-error').count(), 0, 'a successful move shows no error')

  await row(page, 'Reports').dblclick()
  await page.getByRole('button', { name: 'Reports' }).waitFor() // breadcrumb
  await row(page, 'todo.txt').click()
  await page.keyboard.press('Delete')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await until(async () => (await stat(page, '/Reports/todo.txt')) === null, 5000, 'the delete')

  await page.keyboard.press('Backspace')
  await row(page, 'Reports').waitFor()
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
  await page.getByText('b.txt already exists here.').waitFor()
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
  await page.getByText('This folder is empty').waitFor()
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['abc'], 'dropped.txt', { type: 'text/plain' }))
    return dt
  })
  await page.locator('.pg-ex-list').dispatchEvent('dragover', { dataTransfer })
  await page.locator('.pg-ex-list').dispatchEvent('drop', { dataTransfer })
  await until(() => stat(page, '/dropped.txt'), 5000, 'the upload')
})

test('dropping a file on the explorer header uploads it to the current folder', async () => {
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

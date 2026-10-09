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

// A page with the shell's API loaded (the Files page has no app, which these tests don't need).
const shellPage = async (path = '/files/', context) => {
  const page = await openPage(browser, `${site.url}${path}`, { context })
  await page.evaluate(() => import('/shell/files.js'))
  return page
}
const stat = (page, path) => page.evaluate(async (p) => (await import('/shell/store.js')).stat(p), path)

test('saveAs → Keep → Save gives a browser: path; write stores the bytes; read returns them', async () => {
  const page = await shellPage()
  const answer = page.evaluate(() => playgroundFiles.saveAs({ name: 'Book1.xlsx', types: ['xlsx'], bytes: new Uint8Array([1, 2, 3]) }))
  await page.getByRole('button', { name: /Keep in browser storage/ }).click()
  await page.getByLabel('File name').fill('Budget')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  assert.deepEqual(await answer, { path: 'browser:/Budget.xlsx' })
  await page.evaluate(() => playgroundFiles.write('browser:/Budget.xlsx', new Uint8Array([4, 5])))
  await until(() => stat(page, '/Budget.xlsx'), 5000, 'the write')
  assert.deepEqual(await page.evaluate(async () => [...(await playgroundFiles.read('browser:/Budget.xlsx'))]), [4, 5])
})

test('saveAs over an existing file asks to replace it', async () => {
  const page = await shellPage()
  await page.evaluate(() => playgroundFiles.write('browser:/Memo.docx', new Uint8Array([1])))
  await until(() => stat(page, '/Memo.docx'), 5000, 'the first write')
  const answer = page.evaluate(() => playgroundFiles.saveAs({ name: 'Memo.docx', types: ['docx'], bytes: new Uint8Array() }))
  await page.getByRole('button', { name: /Keep in browser storage/ }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Replace' }).click()
  assert.deepEqual(await answer, { path: 'browser:/Memo.docx' })
})

test('saveAs → Download downloads the bytes and answers { download: true }', async () => {
  const page = await shellPage()
  const answer = page.evaluate(() => playgroundFiles.saveAs({ name: 'Deck.pptx', types: ['pptx'], bytes: new Uint8Array([9, 9, 9]) }))
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download to device/ }).click()])
  assert.equal(download.suggestedFilename(), 'Deck.pptx')
  assert.deepEqual(await answer, { download: true })
})

test('saveAs and open answer null on Esc', async () => {
  const page = await shellPage()
  const saved = page.evaluate(() => playgroundFiles.saveAs({ name: 'x.docx', types: ['docx'], bytes: new Uint8Array() }))
  await page.getByRole('button', { name: /Keep in browser storage/ }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await saved, null)
  const opened = page.evaluate(() => playgroundFiles.open({ types: ['docx'] }))
  await page.getByRole('button', { name: 'Open', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await opened, null)
})

test('open lists only the app’s types unless "All files" is on, and returns the picked file', async () => {
  const page = await shellPage()
  await page.evaluate(async () => {
    playgroundFiles.write('browser:/Budget.xlsx', new Uint8Array([1]))
    playgroundFiles.write('browser:/Memo.docx', new Uint8Array([2, 2]))
  })
  await until(() => stat(page, '/Memo.docx'), 5000, 'the writes')
  const opened = page.evaluate(() => playgroundFiles.open({ types: ['docx'] }))
  const dlg = page.getByRole('dialog', { name: 'Open' }) // the Files page's own explorer sits behind it
  await dlg.getByRole('option', { name: /^Memo\.docx/ }).waitFor()
  assert.equal(await dlg.getByRole('option', { name: /^Budget\.xlsx/ }).count(), 0)
  await dlg.getByLabel('All files').check()
  await dlg.getByRole('option', { name: /^Budget\.xlsx/ }).waitFor()
  await dlg.getByRole('option', { name: /^Memo\.docx/ }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  const [file] = await opened
  assert.equal(file.path, 'browser:/Memo.docx')
  assert.equal(file.name, 'Memo.docx')
  assert.deepEqual(Object.values(file.bytes), [2, 2])
})

test('open → From computer returns the file without a path', async () => {
  const page = await shellPage()
  const opened = page.evaluate(() => playgroundFiles.open({ types: ['txt'] }))
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'From computer…' }).click()])
  await chooser.setFiles({ name: 'local.txt', mimeType: 'text/plain', buffer: Buffer.from('hey') })
  const [file] = await opened
  assert.equal(file.path, null)
  assert.equal(file.name, 'local.txt')
  assert.equal(Object.values(file.bytes).length, 3)
})

test('keys typed in a dialog do not reach the page under it', async () => {
  const page = await shellPage()
  await page.evaluate(() => {
    window.leaked = 0
    document.addEventListener('keydown', () => window.leaked++)
  })
  page.evaluate(() => playgroundFiles.saveAs({ name: 'x.docx', types: ['docx'], bytes: new Uint8Array() })).catch(() => {}) // left open; the page closes under it
  await page.getByRole('button', { name: /Keep in browser storage/ }).click()
  await page.getByLabel('File name').pressSequentially('typed name')
  assert.equal(await page.evaluate(() => window.leaked), 0)
})

test('a failed write offers "Download instead" with the bytes', async () => {
  const page = await shellPage()
  await page.evaluate(() => playgroundFiles.write('browser:/f.txt', new Uint8Array([1])))
  await until(() => stat(page, '/f.txt'), 5000, 'the first write')
  await page.evaluate(() => playgroundFiles.write('browser:/f.txt/inside.docx', new Uint8Array([5, 6])))
  const button = page.getByRole('button', { name: 'Download instead' })
  await button.waitFor()
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  assert.equal(download.suggestedFilename(), 'inside.docx')
})

test('write refuses paths outside browser storage', async () => {
  const page = await shellPage()
  const error = await page.evaluate(() => {
    try {
      playgroundFiles.write('memo.docx', new Uint8Array())
      return null
    } catch (e) {
      return e.message
    }
  })
  assert.match(error, /isn't a browser storage path/)
})

test('?open= hands the file to onOpen once', async () => {
  const first = await shellPage()
  await first.evaluate(() => playgroundFiles.write('browser:/Docs/Plan.docx', new Uint8Array([3, 1, 4])))
  await until(() => stat(first, '/Docs/Plan.docx'), 5000, 'the write')
  const page = await openPage(browser, `${site.url}/files/?open=${encodeURIComponent('browser:/Docs/Plan.docx')}`, { context: first.context() })
  const file = await page.evaluate(async () => {
    await import('/shell/files.js')
    return new Promise((resolve) => playgroundFiles.onOpen(resolve))
  })
  assert.equal(file.path, 'browser:/Docs/Plan.docx')
  assert.deepEqual(Object.values(file.bytes), [3, 1, 4])
  assert.equal(new URL(page.url()).searchParams.get('open'), null)
})

test('?open= for a file that is gone shows a notice', async () => {
  const page = await openPage(browser, `${site.url}/files/?open=${encodeURIComponent('browser:/missing.docx')}`)
  await page.evaluate(async () => {
    await import('/shell/files.js')
    playgroundFiles.onOpen(() => {})
  })
  await page.getByText('Couldn’t open missing.docx').waitFor()
})

test('without browser storage, the explorer says so and Save As offers Download only', async () => {
  const context = await browser.newContext({ acceptDownloads: true })
  await context.addInitScript(() => {
    StorageManager.prototype.getDirectory = () => Promise.reject(new DOMException('blocked', 'SecurityError'))
  })
  const page = await openPage(browser, `${site.url}/files/`, { context })
  await page.getByText('Browser storage isn’t available in this window').waitFor()
  await page.evaluate(() => import('/shell/files.js'))
  const answer = page.evaluate(() => playgroundFiles.saveAs({ name: 'x.docx', types: ['docx'], bytes: new Uint8Array([1]) }))
  assert.equal(await page.getByRole('button', { name: /Keep in browser storage/ }).isDisabled(), true)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download to device/ }).click()])
  assert.equal(download.suggestedFilename(), 'x.docx')
  assert.deepEqual(await answer, { download: true })
  await context.close()
})

test('an explorer in another tab refreshes when this tab saves', async () => {
  const a = await shellPage()
  const b = await openPage(browser, `${site.url}/files/`, { context: a.context() })
  await b.getByRole('listbox', { name: 'Files' }).waitFor()
  await a.evaluate(() => playgroundFiles.write('browser:/fromA.txt', new Uint8Array([1])))
  await b.getByRole('option', { name: /^fromA\.txt/ }).waitFor({ timeout: 5000 })
})

test('?open= waits for the app to size its canvas and drop its loader before dropping the file', async () => {
  const first = await shellPage()
  await first.evaluate(() => playgroundFiles.write('browser:/x.txt', new Uint8Array([7])))
  await until(() => stat(first, '/x.txt'), 5000, 'the write')
  const page = await openPage(browser, `${site.url}/files/?open=${encodeURIComponent('browser:/x.txt')}`, { context: first.context() })
  await page.evaluate(() => {
    const canvas = document.createElement('canvas') // a fake app: 300x150 canvas plus a loader
    const loader = Object.assign(document.createElement('div'), { id: 'loading' })
    document.body.prepend(canvas, loader)
    window.dropped = []
    canvas.addEventListener('drop', (e) => window.dropped.push(e.dataTransfer.files[0].name))
    window.fake = { canvas, loader }
  })
  await page.evaluate(() => import('/shell/files.js'))
  await new Promise((r) => setTimeout(r, 2500))
  assert.deepEqual(await page.evaluate(() => window.dropped), [])
  await page.evaluate(() => {
    window.fake.loader.remove()
    window.fake.canvas.width = 800
  })
  await until(() => page.evaluate(() => window.dropped.length), 6000, 'the drop')
  assert.deepEqual(await page.evaluate(() => window.dropped), ['x.txt'])
})

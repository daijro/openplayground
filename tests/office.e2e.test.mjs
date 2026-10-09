// The Office apps against browser storage, end to end: real builds (our patched ones, installed by
// `make fetch` from out/ or the builds release) on the real GPU. Opt in: E2E=1 node --test tests/office.e2e.test.mjs
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { GPU, launch, openPage, startSite, until } from './helpers.mjs'

const E2E = process.env.E2E === '1'
let site, browser, apps
before(async () => {
  if (!E2E) return
  site = await startSite()
  browser = await launch(GPU)
  apps = (await (await fetch(`${site.url}/shell/apps.json`)).json()).groups.flatMap((g) => g.apps)
})
after(async () => {
  await browser?.close()
  await site?.close()
})

const stat = (page, path) => page.evaluate(async (p) => (await import('/shell/store.js')).stat(p), path)
const dialogs = (page) => page.locator('dialog.pg-modal[open]').count()

async function appPage(slug, { context, query = '' } = {}) {
  const app = apps.find((a) => a.slug === slug)
  const page = await openPage(browser, `${site.url}${(app.release ?? app.head).path}${query}`, { context, colorScheme: 'light' })
  await page.waitForFunction(() => !document.querySelector('[id$="_loading"]'), null, { timeout: 120_000 })
  await page.waitForTimeout(2500)
  return page
}

// The shared flow: Save As (Keep) → silent Save → Open from the explorer → silent Save; and Download.
async function roundTrip(slug, { edit, savedAs, autosave }) {
  const page = await appPage(slug)
  await edit(page)
  await page.keyboard.press('Control+s')
  await page.getByRole('button', { name: /Keep in browser storage/ }).click()
  await page.getByLabel('File name').fill(savedAs.replace(/\.\w+$/, ''))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const first = await until(() => stat(page, `/${savedAs}`), 15_000, `${savedAs} to be saved`)

  // Save again: no dialog, and the file changes.
  await edit(page)
  await page.keyboard.press('Control+s')
  const second = await until(async () => {
    const s = await stat(page, `/${savedAs}`)
    return s.modified > first.modified && s
  }, 15_000, 'the silent save')
  assert.equal(await dialogs(page), 0, 'Save on a stored document opened a dialog')

  if (autosave) {
    await edit(page)
    await until(async () => (await stat(page, `/${savedAs}`)).modified > second.modified, 20_000, 'AutoSave')
  }

  // Open it after a reload: the document is bound to its file again.
  await page.reload()
  await page.waitForFunction(() => !document.querySelector('[id$="_loading"]'), null, { timeout: 120_000 })
  await page.waitForTimeout(2500)
  await page.mouse.click(700, 450)
  await page.keyboard.press('Control+o')
  await page.getByRole('option', { name: new RegExp(`^${savedAs.replace('.', '\\.')}`) }).dblclick()
  await page.locator('dialog.pg-modal').waitFor({ state: 'detached' })
  await page.waitForTimeout(1500)
  const before = await stat(page, `/${savedAs}`)
  await edit(page)
  await page.keyboard.press('Control+s')
  await until(async () => (await stat(page, `/${savedAs}`)).modified > before.modified, 15_000, 'the save after Open')
  assert.equal(await dialogs(page), 0, 'Save after Open opened a dialog')

  // Download to device on a fresh document.
  const fresh = await appPage(slug, { context: await browser.newContext({ acceptDownloads: true, colorScheme: 'light' }) })
  await edit(fresh)
  await fresh.keyboard.press('Control+s')
  const [download] = await Promise.all([fresh.waitForEvent('download'), fresh.getByRole('button', { name: /Download to device/ }).click()])
  assert.match(download.suggestedFilename(), new RegExp(`\\.${savedAs.split('.').pop()}$`))
}

// Exports are plain downloads, not Save As: File → Export → PDF downloads a .pdf and opens no shell dialog.
// (Driven through the UI: the app's commands aren't reachable from the page. Coordinates: File tab, Export, PDF.)
test('Word: File → Export → PDF is a plain download', { skip: !E2E }, async () => {
  const page = await appPage('word', { context: await browser.newContext({ acceptDownloads: true, colorScheme: 'light' }) })
  await page.mouse.click(27, 89)
  await page.waitForTimeout(600)
  await page.mouse.click(44, 412)
  await page.waitForTimeout(600)
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.mouse.click(400, 165)])
  assert.match(download.suggestedFilename(), /\.pdf$/)
  assert.equal(await dialogs(page), 0, 'Export opened a shell dialog')
})

test('Word: Save As, Save, AutoSave, Open and Download', { skip: !E2E }, () =>
  roundTrip('word', {
    savedAs: 'E2E Word.docx',
    autosave: true,
    edit: async (page) => {
      await page.mouse.click(700, 450)
      await page.keyboard.type(' hello')
    },
  }))

test('Excel: Save As, Save, Open and Download', { skip: !E2E }, () =>
  roundTrip('excel', {
    savedAs: 'E2E Book.xlsx',
    autosave: false, // Excel's AutoSave is off by default; checked by hand
    edit: async (page) => {
      await page.mouse.click(320, 320)
      await page.keyboard.type(String(Math.floor(Math.random() * 1000)))
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500) // let the engine commit the edit before Ctrl+S
    },
  }))

// Two stored workbooks save to their own files, and opening one that's already open switches to it instead of
// opening a second copy bound to the same file. (?webgl: the canvas is compared as pixels.)
test('Excel: two stored workbooks stay separate; reopening one switches to it', { skip: !E2E }, async () => {
  const page = await appPage('excel', { query: '?webgl' })
  const typeAt = async (text) => {
    await page.mouse.click(320, 320)
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
  }
  const shot = () => page.screenshot({ clip: { x: 0, y: 230, width: 1280, height: 430 } })
  const keep = async (name) => {
    await page.keyboard.press('Control+s')
    await page.getByRole('button', { name: /Keep in browser storage/ }).click()
    await page.getByLabel('File name').fill(name)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await until(() => stat(page, `/${name}.xlsx`), 15_000, `${name}.xlsx`)
    await page.waitForTimeout(1000) // the background write settles
    return stat(page, `/${name}.xlsx`)
  }
  const openStored = async (name) => {
    await page.keyboard.press('Control+o')
    await page.getByRole('option', { name: new RegExp(`^${name}\\.xlsx`) }).dblclick()
    await page.locator('dialog.pg-modal').waitFor({ state: 'detached' })
    await page.waitForTimeout(1000)
  }
  const saved = async (name, before) => {
    await page.keyboard.press('Control+s')
    await until(async () => (await stat(page, `/${name}.xlsx`)).modified > before.modified, 15_000, `${name} to change`)
    await page.waitForTimeout(1000)
    return stat(page, `/${name}.xlsx`)
  }

  await typeAt('7')
  const a = await keep('Sheet A')
  const shotA = await shot()
  await page.keyboard.press('Control+n')
  await page.waitForTimeout(800)
  await typeAt('5')
  const b = await keep('Sheet B')
  assert.notDeepEqual(await shot(), shotA, 'the workbooks should look different (is the canvas rendering?)')

  // Each saves to its own file.
  await openStored('Sheet A')
  await typeAt('9')
  const dirtyA = await shot() // A with an unsaved 9
  await openStored('Sheet B')
  await typeAt('3')
  const b2 = await saved('Sheet B', b)
  assert.equal((await stat(page, '/Sheet A.xlsx')).modified, a.modified, 'saving B changed A')

  // Opening A again switches to the open A (still showing its unsaved 9), not a fresh copy of the stored file.
  await openStored('Sheet A')
  assert.deepEqual(await shot(), dirtyA, 'a second copy of A was opened')
  await saved('Sheet A', a)
  assert.equal((await stat(page, '/Sheet B.xlsx')).modified, b2.modified, 'saving A changed B')
  assert.equal(await dialogs(page), 0)
})

test('PowerPoint: Save As, Save, Open and Download', { skip: !E2E }, () =>
  roundTrip('powerpoint', {
    savedAs: 'E2E Deck.deckcraft',
    autosave: false, // PowerPoint has no AutoSave
    edit: async (page) => {
      // Saving writes even without changes (save() saves whenever the deck has a path); just focus the app.
      await page.mouse.click(700, 450)
    },
  }))

// Exports are plain downloads, not Save As: Export… (PDF) downloads a .pdf and opens no shell dialog.
// (Driven through the UI: the command palette's second "Export…" is the dialog; its Export button is at 774,474.)
test('PowerPoint: Export is a plain download', { skip: !E2E }, async () => {
  const page = await appPage('powerpoint', { query: '?webgl', context: await browser.newContext({ acceptDownloads: true, colorScheme: 'light' }) })
  await page.mouse.click(1258, 54)
  await page.waitForTimeout(500)
  await page.keyboard.type('export')
  await page.waitForTimeout(500)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), page.mouse.click(774, 474)])
  assert.match(download.suggestedFilename(), /\.pdf$/)
  assert.equal(await dialogs(page), 0, 'Export opened a shell dialog')
})

// Two stored decks save to their own files, and opening one that's already open switches to it instead of
// opening a second copy bound to the same file. (?webgl: the canvas is compared as pixels; the open deck has
// an unsaved extra slide, which a second copy read from storage wouldn't.)
test('PowerPoint: two stored decks stay separate; reopening one switches to it', { skip: !E2E }, async () => {
  const page = await appPage('powerpoint', { query: '?webgl' })
  const shot = async () => {
    await page.mouse.move(700, 670) // off the ribbon: no hover highlight in the pixels
    await page.waitForTimeout(300)
    return page.screenshot({ clip: { x: 0, y: 36, width: 1280, height: 654 } })
  }
  const keep = async (name) => {
    await page.keyboard.press('Control+s')
    await page.getByRole('button', { name: /Keep in browser storage/ }).click()
    await page.getByLabel('File name').fill(name)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await until(() => stat(page, `/${name}.deckcraft`), 15_000, `${name}.deckcraft`)
    await page.waitForTimeout(1000) // the background write settles
    return stat(page, `/${name}.deckcraft`)
  }
  const openStored = async (name) => {
    await page.keyboard.press('Control+o')
    await page.getByRole('option', { name: new RegExp(`^${name}\\.deckcraft`) }).dblclick()
    await page.locator('dialog.pg-modal').waitFor({ state: 'detached' })
    await page.waitForTimeout(1000)
  }
  const saved = async (name, before) => {
    await page.keyboard.press('Control+s')
    await until(async () => (await stat(page, `/${name}.deckcraft`)).modified > before.modified, 15_000, `${name} to change`)
    await page.waitForTimeout(1000)
    return stat(page, `/${name}.deckcraft`)
  }
  const newSlide = async () => {
    await page.mouse.click(168, 128)
    await page.waitForTimeout(500)
  }

  const a = await keep('Deck A') // the sample deck
  await page.mouse.click(21, 54) // a new, blank deck
  await page.waitForTimeout(800)
  const b = await keep('Deck B')

  await openStored('Deck A') // switches to the open Deck A
  await newSlide() // unsaved
  const dirtyA = await shot()
  await openStored('Deck B')
  assert.ok(!(await shot()).equals(dirtyA), 'the decks should look different (is the canvas rendering?)')
  await newSlide()
  const b2 = await saved('Deck B', b)
  assert.equal((await stat(page, '/Deck A.deckcraft')).modified, a.modified, 'saving B changed A')

  // Opening A again switches to the open A (still showing its unsaved slide), not a fresh copy of the stored file.
  await openStored('Deck A')
  assert.ok((await shot()).equals(dirtyA), 'a second copy of A was opened') // (equals, not deepEqual: a failing deepEqual of two PNGs hangs printing the diff)
  await saved('Deck A', a)
  assert.equal((await stat(page, '/Deck B.deckcraft')).modified, b2.modified, 'saving A changed B')
  assert.equal(await dialogs(page), 0)
})

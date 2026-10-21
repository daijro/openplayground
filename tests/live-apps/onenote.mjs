// NoteCraft (onenote): a fresh browser starts with the bundled Welcome notebook open; the joiner then adopts the
// owner's notebooks (same paths). Rows of the tree are
// 27 points apart under the shell's bar; a click on a block of the page puts the caret in it; the Draw tab's pens make
// the pointer draw on the page (its ink.svg), and Type gives it back to the text. The owner types a letter at the
// start of the welcome page's first paragraph; both editors work on that page. Ctrl+Z (the session's Undo while
// connected) takes back only the owner's letter.
// drag(): the owner draws, the pen held down (presence `ink`: the stroke so far); release() lets go and takes the
// stroke back with Ctrl+Z, so nothing has changed, and picks Type again. point(): the owner clicks into the paragraph
// and rests the pointer on the page (presence: page, pointer, caret). importMedia(): the owner drops a picture on the
// page and inserts it: the editor and the late viewer get its bytes. Every page is in the document, so opening one is
// presence (the tree's dots), not a new document: there is no openTab().
import { until } from '../helpers.mjs'

const checkpoint = (page) => page.evaluate(() => {
  try { return new TextDecoder().decode(playgroundLiveAdapter.checkpoint()) } catch (e) { return `error: ${e}` }
})
const presence = (page) => page.evaluate(() => playgroundLiveAdapter.presence())
// The first paragraph of the welcome page, tree rows, the
// Draw tab with its Type tool and first pen, and somewhere to draw (over the page's words).
const PARAGRAPH = { x: 410, y: 730 }
const DRAW = { x: 195, y: 82 }, TYPE = { x: 287, y: 140 }, PEN = { x: 391, y: 140 }, SHEET = { x: 520, y: 470 }
// The first choice of the dialog a dropped file opens (centred in the window).
const INSERT_PICTURE = { x: 503, y: 397 }
// A letter typed where `at` is, until the shared document has it.
async function type(page, at, letter) {
  const before = await checkpoint(page)
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(300)
  await page.keyboard.type(letter)
  await until(async () => { const t = await checkpoint(page); return !t.startsWith('error') && t !== before }, 10000, `${letter} to be typed`)
}
// Picks the first pen, puts it down on the page and draws to the right (still held).
async function penDown(page) {
  await page.mouse.click(DRAW.x, DRAW.y)
  await page.waitForTimeout(200)
  await page.mouse.click(PEN.x, PEN.y)
  await page.waitForTimeout(200)
  await page.mouse.move(SHEET.x, SHEET.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) { await page.mouse.move(SHEET.x + 20 * i, SHEET.y + (i % 2) * 12); await page.waitForTimeout(40) }
}
const ink = (doc) => !!doc.files?.['welcome-to-notecraft']?.['00-start']?.welcome?.['ink.svg']

export default {
  path: '/head/notecraft/',
  url: '/head/notecraft/index.html',
  viewport: { width: 1280, height: 800 },
  ready: async (page) => {
    await until(async () => JSON.parse((await checkpoint(page)).replace(/^error.*/, '{}')).files?.['welcome-to-notecraft']?.['00-start']?.welcome?.['index.html'], 120000, 'the Welcome notebook')
    await page.waitForTimeout(500)
  },
  drag: async (page) => {
    await penDown(page)
    await until(async () => (await presence(page))?.ink?.points?.length > 3, 10000, 'the stroke under way')
  },
  release: async (page) => {
    await page.mouse.up()
    await until(async () => ink(JSON.parse(await checkpoint(page))), 10000, 'the stroke in the page')
    await page.keyboard.press('Control+z')
    await until(async () => !ink(JSON.parse(await checkpoint(page))), 10000, 'the stroke taken back')
    await page.mouse.click(TYPE.x, TYPE.y)
  },
  point: async (page) => {
    await page.mouse.click(PARAGRAPH.x + 60, PARAGRAPH.y)
    await page.mouse.move(640, 480)
    await until(async () => { const p = await presence(page); return p?.pointer && p.caret }, 10000, 'the owner\'s pointer and caret')
  },
  editA: (page) => type(page, PARAGRAPH, 'A'),
  editB: async (page) => {
    await penDown(page)
    await page.mouse.up()
    await until(async () => ink(JSON.parse(await checkpoint(page))), 10000, 'the editor\'s stroke in the page')
  },
  undo: (page) => page.keyboard.press('Control+z'),
  importMedia: async (page) => {
    // A picture dropped on the page (as Playground's Files hands files to apps), then "Insert the picture" in the dialog
    // that asks what to do with it: a copy in the page's assets folder, and an <img> in the page.
    await page.evaluate(async () => {
      const c = document.createElement('canvas')
      Object.assign(c, { width: 64, height: 48 })
      const g = c.getContext('2d')
      g.fillStyle = '#ca64ea'
      g.fillRect(0, 0, 64, 48)
      const data = new DataTransfer()
      data.items.add(new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'swatch.png', { type: 'image/png' }))
      const canvas = document.querySelector('canvas'), r = canvas.getBoundingClientRect()
      const at = { clientX: r.left + 700, clientY: r.top + 400, bubbles: true, cancelable: true, dataTransfer: data }
      for (const type of ['dragenter', 'dragover', 'drop']) canvas.dispatchEvent(new DragEvent(type, at))
    })
    await page.waitForTimeout(800)
    await page.mouse.click(INSERT_PICTURE.x, INSERT_PICTURE.y)
    await until(async () => Object.keys(JSON.parse(await checkpoint(page)).media ?? {}).length, 10000, 'the picture in the page')
  },
}

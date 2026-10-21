import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { sessionSite } from './session-helpers.mjs'
import { until } from './helpers.mjs'

// Live editing in real app builds that use patches/live/playground_live.rs (JSON documents). LIVE_PUBLIC is a public
// directory holding each patched build at its URL path with the shell injected (tests/live-apps/README.md). Each
// tests/live-apps/<slug>.mjs exports { path, viewport?, ready?(page), editA(page), editB(page), undo(page), ignore? }:
// two edits to different objects, then Undo of the owner's; `ignore` lists path prefixes of allocator counters. An app
// that keeps media outside the document also exports importMedia(page), which adds one in the owner's browser; one
// that shows the others' pointers and selections exports point(page), which moves or selects in the owner's; drag(page)
// holds a gesture mid-way (mouse down, no release), and release(page) ends it without an edit (default: Escape, up);
// openTab(page) opens another document in the owner's app (shared tabs).
const publicDir = process.env.LIVE_PUBLIC
const only = process.env.LIVE_APPS?.split(',')
const specs = readdirSync(new URL('./live-apps/', import.meta.url)).filter((f) => f.endsWith('.mjs'))
  .map((f) => f.slice(0, -4)).filter((slug) => !only || only.includes(slug))
let site
// LIVE_GPU=1 launches with WebGPU on the real GPU, which apps like SubCraft need.
before(async () => { if (publicDir) site = await sessionSite({ publicDir, gpu: process.env.LIVE_GPU === '1' }) })
after(async () => { await site?.close() })

async function open(app) {
  const page = await site.page()
  await page.setViewportSize(app.viewport ?? { width: 1280, height: 800 })
  await page.goto(`${site.url}${app.url ?? app.path}`)
  await until(() => page.evaluate(() => !!globalThis.playgroundLiveAdapter), 120000, `${app.path} to start`)
  await page.evaluate(async (path) => {
    const { PeerSession, setPage } = await import('/shell/session.js')
    window.PeerSession = PeerSession; setPage(path)
  }, app.path)
  await app.ready?.(page)
  return page
}
// Normalized, so a document's text compares equal to its own JSON.stringify(JSON.parse(...)) (e.g. 104.0 and 104). An app
// with a binary checkpoint defines globalThis.liveTestDocument() in its spec's `ready` to give it as JSON.
const json = (page) => page.evaluate(() => JSON.stringify(JSON.parse(globalThis.liveTestDocument?.()
  ?? new TextDecoder().decode(playgroundLiveAdapter.checkpoint()))))
const status = (page) => page.evaluate(() => session.live?.status)
const follow = (page) => page.evaluate(async () => { await (await import('/shell/live.js')).follow(session) })
// Every page has the same document, different from `before` when given.
const same = (pages, what, before) => until(async () => {
  const docs = new Set(await Promise.all(pages.map(json)))
  return docs.size === 1 && !docs.has(before) && [...docs][0]
}, 30000, what)
// The JSON paths whose values differ between two documents.
function changes(a, b, path = '', out = new Map()) {
  if (JSON.stringify(a) === JSON.stringify(b)) return out
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) changes(a[key], b[key], `${path}/${key}`, out)
  } else out.set(path, b)
  return out
}
// The media this page has, as `id sha256` lines: the same on every page once shared.
const media = (page) => page.evaluate(async () => {
  const hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await new Blob([bytes]).arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const list = await playgroundLiveAdapter.assets()
  return list.every((a) => a.have) ? (await Promise.all(list.map(async (a) => `${a.id} ${await hex(await playgroundLiveAdapter.readAsset(a.id))}`))).sort().join('\n') : null
})
const sameMedia = (pages, what) => until(async () => {
  const all = new Set(await Promise.all(pages.map(media)))
  return all.size === 1 && !!all.values().next().value
}, 60000, what)
const at = (doc, path) => path.split('/').slice(1).reduce((v, k) => v?.[k], doc)

for (const slug of specs) {
  const exists = publicDir && existsSync(`${publicDir}/${slug}.ok`)
  test(`${slug}: two people edit live, views stay local, Undo reverts only its author, a late viewer catches up`, { skip: !exists && 'no LIVE_PUBLIC build' }, async () => {
    const app = (await import(`./live-apps/${slug}.mjs`)).default
    const a = await open(app), b = await open(app)
    const invite = await a.evaluate(async (path) => {
      window.session = await PeerSession.create({ app: path, name: 'Alice' })
      return { editor: session.invite('editor'), viewer: session.invite('viewer') }
    }, app.path)
    await follow(a)
    await b.evaluate(async (invite) => { window.session = await PeerSession.join(invite, { name: 'Bob' }) }, invite.editor)
    await follow(b)
    await until(async () => await status(a) === 'live' && await status(b) === 'live', 30000, 'live editing')
    const start = JSON.parse(await same([a, b], 'the joiner to adopt the owner\'s document'))

    if (app.point || app.drag) {
      // What the editor's app is given to show of the others.
      await b.evaluate(() => {
        const show = playgroundLiveAdapter.showPresence
        playgroundLiveAdapter.showPresence = (others) => { window.shownPresence = others; return show(others) }
      })
    }
    // A gesture held mid-way (no release): the editor is shown its in-progress state, which at rest is not there.
    if (app.drag) {
      const id = await a.evaluate(() => session.id), rest = await a.evaluate(() => playgroundLiveAdapter.presence())
      await app.drag(a)
      const held = await a.evaluate(() => playgroundLiveAdapter.presence())
      assert.ok(Object.keys(held ?? {}).some((k) => !(k in (rest ?? {}))), 'drag() gives the owner an in-progress field in presence()')
      await until(() => b.evaluate(([id, held]) => JSON.stringify(window.shownPresence?.find((p) => p.id === id)?.state) === JSON.stringify(held), [id, held]), 10000, 'the owner\'s gesture to reach the editor mid-way')
      // Cancelled, so nothing changes: Escape first, then let go.
      if (app.release) await app.release(a)
      else { await a.keyboard.press('Escape'); await a.mouse.up() }
      await a.waitForTimeout(300)
    }
    if (app.point) {
      await app.point(a)
      const [id, mine] = await a.evaluate(() => [session.id, playgroundLiveAdapter.presence()])
      assert.notEqual(mine, null, 'point() gives the owner a presence')
      await until(() => b.evaluate(([id, mine]) => JSON.stringify(window.shownPresence?.find((p) => p.id === id)?.state) === JSON.stringify(mine), [id, mine]), 10000, 'the owner\'s presence to reach the editor')
    }
    await app.editA(a)
    const afterA = JSON.parse(await same([a, b], 'the owner\'s edit to reach the editor', JSON.stringify(start)))
    await app.editB(b)
    const afterB = JSON.parse(await same([a, b], 'the editor\'s edit to reach the owner', JSON.stringify(afterA)))
    await app.undo(a)
    const undone = JSON.parse(await same([a, b], 'the owner\'s Undo to reach the editor', JSON.stringify(afterB)))
    // Allocator counters (the adapter's COUNTERS) only ever go up, so Undo leaves them where they are.
    const checked = (path) => !(app.ignore ?? []).some((prefix) => path.startsWith(prefix))
    for (const [path] of changes(start, afterA)) if (checked(path)) assert.deepEqual(at(undone, path), at(start, path), `Undo reverts ${path}`)
    for (const [path, value] of changes(afterA, afterB)) if (checked(path)) assert.deepEqual(at(undone, path), value, `Undo keeps the editor's ${path}`)
    if (app.importMedia) {
      await app.importMedia(a)
      await same([a, b], 'the owner\'s import to reach the editor', JSON.stringify(undone))
      await sameMedia([a, b], 'the imported media to reach the editor')
    }

    // A second document opened in the session (shared tabs) reaches the editor, and the late viewer gets both.
    if (app.openTab) {
      const before = await json(a)
      await app.openTab(a)
      await same([a, b], 'the owner\'s new document to reach the editor', before)
    }

    const c = await open(app)
    await c.evaluate(async (invite) => { window.session = await PeerSession.join(invite, { name: 'Carol' }) }, invite.viewer)
    await follow(c)
    await same([a, b, c], 'the late viewer to catch up')
    await until(async () => await status(c) === 'read-only', 10000, 'the viewer to be read-only')
    if (app.importMedia) await sameMedia([a, c], 'the media to reach the late viewer')
    for (const page of [a, b, c]) await page.evaluate(() => session.leave())
  })
}

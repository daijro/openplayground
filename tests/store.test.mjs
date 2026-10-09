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

// Runs `body` (a function source taking `store`) in a fresh profile's page; returns its result.
const run = async (body, page) => {
  page ??= await openPage(browser, `${site.url}/shell/paths.js`)
  return page.evaluate(async (src) => {
    const store = await import('/shell/store.js')
    return new Function('store', `return (${src})(store)`)(store)
  }, body.toString())
}

test('write, read, stat and list', async () => {
  const result = await run(async (store) => {
    await store.write('/Reports/Q3/budget.xlsx', new Uint8Array([1, 2, 3]))
    await store.write('/Reports/notes.txt', new Blob(['hi']))
    const bytes = [...(await store.read('/Reports/Q3/budget.xlsx'))]
    return { bytes, stat: await store.stat('/Reports/Q3/budget.xlsx'), folder: await store.stat('/Reports/Q3'), missing: await store.stat('/nope'), list: await store.list('/Reports') }
  })
  assert.deepEqual(result.bytes, [1, 2, 3])
  assert.equal(result.stat.kind, 'file')
  assert.equal(result.stat.size, 3)
  assert.equal(result.folder.kind, 'folder')
  assert.equal(result.missing, null)
  assert.deepEqual(result.list.map((e) => [e.name, e.kind, e.path]), [['Q3', 'folder', '/Reports/Q3'], ['notes.txt', 'file', '/Reports/notes.txt']])
})

test('writes to one path land in order, and the last one wins', async () => {
  const result = await run(async (store) => {
    const writes = []
    for (let i = 0; i < 20; i++) writes.push(store.write('/a.txt', new TextEncoder().encode(String(i))))
    const pendingWhileQueued = store.pendingWrites()
    await Promise.all(writes)
    return { text: new TextDecoder().decode(await store.read('/a.txt')), pendingWhileQueued, pendingAfter: store.pendingWrites() }
  })
  assert.equal(result.text, '19')
  assert.ok(result.pendingWhileQueued > 0)
  assert.equal(result.pendingAfter, 0)
})

test('move and rename files and folders; refuse clobbering and moving into itself', async () => {
  const result = await run(async (store) => {
    await store.write('/a/one.txt', new Uint8Array([1]))
    await store.write('/a/sub/two.txt', new Uint8Array([2]))
    await store.move('/a/one.txt', '/a/uno.txt')
    await store.move('/a', '/b')
    const errors = []
    await store.write('/c.txt', new Uint8Array([3]))
    await store.move('/c.txt', '/b/uno.txt').catch((e) => errors.push(e.message))
    await store.move('/b', '/b/sub/b').catch((e) => errors.push(e.message))
    return { a: await store.stat('/a'), uno: [...(await store.read('/b/uno.txt'))], two: [...(await store.read('/b/sub/two.txt'))], errors }
  })
  assert.equal(result.a, null)
  assert.deepEqual(result.uno, [1])
  assert.deepEqual(result.two, [2])
  assert.equal(result.errors.length, 2)
  assert.match(result.errors[0], /already exists/)
  assert.match(result.errors[1], /into itself/)
})

test('remove deletes folders recursively; mkdir makes empty folders', async () => {
  const result = await run(async (store) => {
    await store.write('/x/y/z.txt', new Uint8Array([1]))
    await store.remove('/x')
    await store.mkdir('/Empty')
    return { x: await store.stat('/x'), empty: await store.list('/Empty'), root: (await store.list('/')).map((e) => e.name) }
  })
  assert.equal(result.x, null)
  assert.deepEqual(result.empty, [])
  assert.deepEqual(result.root, ['Empty'])
})

test('a write through a file used as a folder rejects', async () => {
  const message = await run(async (store) => {
    await store.write('/f.txt', new Uint8Array([1]))
    return store.write('/f.txt/g.txt', new Uint8Array([2])).then(() => 'resolved', (e) => e.name)
  })
  assert.notEqual(message, 'resolved')
})

test('the store keeps to its own folder of the origin storage', async () => {
  const names = await run(async (store) => {
    await store.write('/mine.txt', new Uint8Array([1]))
    const root = await navigator.storage.getDirectory()
    const names = []
    for await (const name of root.keys()) names.push(name)
    return names
  })
  assert.deepEqual(names, ['playground-files'])
})

test('onChange reports changes in this tab and in other tabs', async () => {
  const context = await browser.newContext()
  const a = await openPage(browser, `${site.url}/shell/paths.js`, { context })
  const b = await openPage(browser, `${site.url}/shell/paths.js`, { context })
  await b.evaluate(async () => {
    const store = await import('/shell/store.js')
    window.changes = []
    store.onChange((dir) => window.changes.push(dir))
  })
  await run(async (store) => store.write('/Shared/x.txt', new Uint8Array([1])), a)
  const seen = await until(() => b.evaluate(() => window.changes.includes('/Shared') && window.changes), 5000, 'the other tab to hear the change')
  assert.ok(seen.includes('/Shared'))
  await context.close()
})

# Browser Files, Explorer and App Top Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every app page gets a top bar (app switcher, version, Files, fullscreen), and Word, Excel and PowerPoint open, save, save-as and autosave documents in browser storage through one shared file explorer.

**Architecture:**
- **Shell:** a JavaScript module set in `shell/`, served at `/shell/` by Vite and copied into the build. It provides:
  - the OPFS file store;
  - the explorer;
  - the Open and Save As dialogs and `globalThis.playgroundFiles`;
  - the top bar.
- **Injection:** `scripts/fetch.mjs` adds the shell to every installed app page.
- **App patches:** `patches/word.yaml`, `excel.yaml` and `powerpoint.yaml` connect each app's file services to `playgroundFiles`, as follows.
  - A small Rust bridge module is appended to each app's `web.rs`.
  - Its answers re-enter the app through the app's own control channel.
  - The engines' wasm write stubs call a hook that the bridge fills in.

**Tech Stack:**
- Vanilla ES modules and CSS (no framework).
- OPFS (`navigator.storage.getDirectory`).
- Vite 8 (dev server and build).
- `node:test` with `playwright-core` driving the system Chromium.
- Rust/eframe apps patched through `scripts/build.mjs` rules.
- `js-sys`, `wasm-bindgen` and `wasm-bindgen-futures` (already dependencies of each app's web crate).

**Spec:** `docs/superpowers/specs/2026-10-09-browser-files-design.md`

## Global Constraints

- **Store location:** files live under the OPFS folder `playground-files/`, never at the OPFS root. Lightroom's library and After Effects' store share the origin.
- **App paths:** apps see store files as `browser:/Folder/name.ext`.
  - Store paths have no scheme, e.g. `/Folder/name.ext`.
  - Convert only through `shell/paths.js` (`toAppPath`, `fromAppPath`).
- **Global API:** `globalThis.playgroundFiles` is exactly `{ open, saveAs, write, read, download, onOpen }`, with the contracts in Task 5. The Rust bridges depend on these names.
- **`saveAs({ name, types, bytes })`:**
  - "Download to device" downloads `bytes` itself and resolves `{ download: true }`.
  - "Keep" resolves `{ path: 'browser:/…' }`.
  - Cancel resolves `null`.
- **Exports:** exports (PDF, PNG, CSV and the like) stay plain downloads. Only Save and Save As go through the dialogs.
- **Missing shell:** when `playgroundFiles` is missing, each app keeps upstream behavior (rfd and downloads).
- **Look:** the shell's UI uses the dashboard's fonts (Geist, Geist Mono) and follows `prefers-color-scheme`.
- **Bar height:** the top bar is 36 px (`--pg-bar`), and every app's first `<body>` canvas sits below it.
- **Patch rules:** every new patch rule starts with a comment block:
  - **What it's for:** in user terms.
  - **How:** the mechanism and the contract it relies on.
  - **Verify:** how to check it still works.
  - **If upstream changes:** what to do when upstream moves or replaces the code, including when to delete the rule.
- **Patches must apply on both channels:** they must compile with `node scripts/build.mjs check <slug> release` and `… head`. Locally, prefix these with `RUSTUP_TOOLCHAIN=1.99.0`, because local `stable` is 1.91 and too old.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Run `git pull --rebase` before each push, because the update bot pushes to `main` constantly.

## Review Focus

Failure modes that no task's main flow exercises, most likely first. Each one gets a test in the task named.

1. **Keystrokes leaking into the app.** Typing a file name in a dialog over an app must not also reach the app (eframe listens on `document`). The test sends keys in the Save dialog and counts document-level `keydown` events (Task 5).
2. **Awkward file names.** Names with spaces, several dots, unicode or no extension (`Q3 report (final).v2.docx`, `Résumé`) must keep their extension logic: `withType`, `uniqueName`, `extOf` (Task 1).
3. **A failed store write.** It must surface a toast with **Download instead** that holds the bytes. The test writes through a parent that is a file (Task 5).
4. **Changes from another tab.** An explorer open in tab B must refresh when tab A writes (Task 5).
5. **A `?open=` file deleted in the meantime.** It must show a "Couldn't open" toast, not throw silently (Task 5).

---

## File Structure

| File | Responsibility |
|---|---|
| `shell/paths.js` (new) | Pure path, name and format helpers. No DOM, no storage. |
| `shell/store.js` (new) | The OPFS store: list, stat, read, a queued write, mkdir, move, remove, usage, change events (local and other tabs). |
| `shell/ui.js` (new) | DOM helpers: `h`, `icon`, `modal`, `toast`, `confirmIn`, `download`. |
| `shell/apps.js` (new) | Loads `/shell/apps.json`; `currentApp()`, `appHref()`. |
| `shell/explorer.js` (new) | The explorer component (browse / open / save modes). |
| `shell/files.js` (new) | `globalThis.playgroundFiles`, the Open / Save As / Files dialogs, startup `?open=`. |
| `shell/topbar.js` (new) | The bar: home, app switcher, version, Files, fullscreen. |
| `shell/app.js` (new) | Entry for app pages: mounts the bar, installs the leave warning. |
| `shell/files-page.js` (new) | Entry for `/files/`. |
| `shell/shell.css` (new) | All shell styles, plus moving the app canvas below the bar. |
| `files/index.html` (new) | The Files page (a Vite page). |
| `vite.config.js` (modify) | Serve `/shell/` in dev, generate `/shell/apps.json`, copy `shell/` into the build, add the Files page input. |
| `scripts/fetch.mjs` (modify) | Inject `shell.css` and `app.js` into each app page. |
| `scripts/page-prelude.js` (modify) | Leave keys and pastes inside shell UI alone. |
| `tools.yaml` (modify) | Each app's `opens:` file types. |
| `index.html` (modify) | Dashboard **Files** link. |
| `patches/word.yaml`, `patches/excel.yaml`, `patches/powerpoint.yaml` (modify) | The browser-storage rules. |
| `.github/workflows/build.yml` (modify) | Repair prompt: rules' comments state purpose and contract. |
| `tests/helpers.mjs` (new) | Start Vite in-process, launch Chromium, polling helper. |
| `tests/paths.test.mjs`, `store.test.mjs`, `shell.test.mjs`, `files.test.mjs`, `topbar.test.mjs`, `office.e2e.test.mjs` (new) | Tests. |
| `package.json` (modify) | `playwright-core` dev dependency, `npm test`. |

---

### Task 1: Test harness and path helpers

**Files:**
- Modify: `package.json`
- Create: `tests/helpers.mjs`, `tests/paths.test.mjs`, `shell/paths.js`

**Interfaces:**
- Produces `shell/paths.js`:
  - `SCHEME`
  - `normalize(path) → '/a/b'`
  - `toAppPath(path) → 'browser:/a/b'`
  - `fromAppPath(appPath) → '/a/b' | null`
  - `baseName(path)`
  - `parentOf(path)`
  - `join(dir, name)`
  - `ancestry(path) → ['/', '/a', '/a/b']`
  - `extOf(name) → 'docx' | ''`
  - `validName(name) → boolean`
  - `matchesTypes(name, types) → boolean`
  - `withType(name, types) → string`
  - `uniqueName(name, takenSet) → string`
  - `formatSize(bytes) → string`
  - `formatWhen(ms, now?) → string`
  - `appFor(apps, name) → app | null`
- Produces `tests/helpers.mjs`:
  - `startSite() → { url, close }`
  - `launch(args?) → Browser`
  - `openPage(browser, url, opts?) → Page`
  - `until(fn, ms?) → value`
  - `GPU` (array of Chromium flags)

- [ ] **Step 1: Add the dev dependency and the test script**

Run: `npm install --save-dev playwright-core`

Then edit `package.json` so `"scripts"` reads:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "fetch": "node scripts/fetch.mjs",
    "test": "node --test tests/"
  },
```

- [ ] **Step 2: Write `tests/helpers.mjs`**

```js
// Shared by the tests: the dev site (Vite, in-process, on a free port) and a Chromium to drive it.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// The system Chromium (Arch: /usr/sbin/chromium); CHROMIUM=... overrides it.
export const CHROMIUM = process.env.CHROMIUM ?? '/usr/sbin/chromium'
// Real-GPU flags (WebGPU on Vulkan) for tests that run the apps themselves; the shell tests don't need them.
export const GPU = ['--use-angle=vulkan', '--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-vulkan=native', '--disable-vulkan-surface']

export async function startSite() {
  const server = await createServer({ logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const { port } = server.httpServer.address()
  return { url: `http://localhost:${port}`, close: () => server.close() }
}

export const launch = (args = []) => chromium.launch({ executablePath: CHROMIUM, args })

/** A page in a fresh browser profile (so its browser storage starts empty), opened on `url`. */
export async function openPage(browser, url, { colorScheme = 'dark', context } = {}) {
  context ??= await browser.newContext({ colorScheme, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.error(`page error on ${url}:`, e.message))
  await page.goto(url)
  return page
}

/** Poll `fn` until it returns something truthy; throw after `ms`. */
export async function until(fn, ms = 10000, what = 'condition') {
  const end = Date.now() + ms
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}
```

- [ ] **Step 3: Write the failing tests `tests/paths.test.mjs`**

```js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ancestry, appFor, baseName, extOf, formatSize, formatWhen, fromAppPath, join, matchesTypes, normalize,
  parentOf, toAppPath, uniqueName, validName, withType,
} from '../shell/paths.js'

test('normalize keeps paths absolute and drops empty, . and .. segments', () => {
  assert.equal(normalize(''), '/')
  assert.equal(normalize('a//b/./c/'), '/a/b/c')
  assert.equal(normalize('/a/../b'), '/a/b')
  assert.equal(normalize('\\a\\b'), '/a/b')
})

test('app paths carry the browser: scheme', () => {
  assert.equal(toAppPath('/Reports/budget.xlsx'), 'browser:/Reports/budget.xlsx')
  assert.equal(fromAppPath('browser:/Reports/budget.xlsx'), '/Reports/budget.xlsx')
  assert.equal(fromAppPath('budget.xlsx'), null)
  assert.equal(fromAppPath(null), null)
})

test('names and folders', () => {
  assert.equal(baseName('/a/b/Q3 report (final).v2.docx'), 'Q3 report (final).v2.docx')
  assert.equal(parentOf('/a/b/c.txt'), '/a/b')
  assert.equal(parentOf('/c.txt'), '/')
  assert.equal(join('/a', 'b.txt'), '/a/b.txt')
  assert.equal(join('/', 'b.txt'), '/b.txt')
  assert.deepEqual(ancestry('/a/b'), ['/', '/a', '/a/b'])
  assert.deepEqual(ancestry('/'), ['/'])
})

test('extensions', () => {
  assert.equal(extOf('Q3 report (final).v2.DOCX'), 'docx')
  assert.equal(extOf('Résumé'), '')
  assert.equal(extOf('.hidden'), '')
  assert.equal(matchesTypes('a.xlsx', ['xlsx', 'csv']), true)
  assert.equal(matchesTypes('a.docx', ['xlsx']), false)
  assert.equal(matchesTypes('a.docx', []), true)
  assert.equal(withType('Budget', ['xlsx']), 'Budget.xlsx')
  assert.equal(withType('Budget.xlsx', ['xlsx']), 'Budget.xlsx')
  assert.equal(withType('Notes.odt', ['docx', 'odt']), 'Notes.odt')
  assert.equal(withType('Q3 report (final).v2', ['docx']), 'Q3 report (final).v2.docx')
  assert.equal(withType('Anything', []), 'Anything')
})

test('valid names', () => {
  for (const ok of ['Budget.xlsx', 'Résumé', 'Q3 report (final).v2.docx', '  spaced  ']) assert.equal(validName(ok), true, ok)
  for (const bad of ['', '   ', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b', 'a\u0001b']) assert.equal(validName(bad), false, bad)
})

test('uniqueName counts up before the extension', () => {
  assert.equal(uniqueName('Report.docx', new Set()), 'Report.docx')
  assert.equal(uniqueName('Report.docx', new Set(['Report.docx'])), 'Report (2).docx')
  assert.equal(uniqueName('Report.docx', new Set(['Report.docx', 'Report (2).docx'])), 'Report (3).docx')
  assert.equal(uniqueName('New folder', new Set(['New folder'])), 'New folder (2)')
})

test('sizes and times', () => {
  assert.equal(formatSize(0), '0 B')
  assert.equal(formatSize(999), '999 B')
  assert.equal(formatSize(1500), '1.5 KB')
  assert.equal(formatSize(12_000), '12 KB')
  assert.equal(formatSize(999_999), '1.0 MB')
  assert.equal(formatSize(3_400_000_000), '3.4 GB')
  const now = Date.parse('2026-10-09T12:00:00Z')
  assert.equal(formatWhen(now - 5_000, now), 'just now')
  assert.equal(formatWhen(now - 5 * 60_000, now), '5 minutes ago')
  assert.equal(formatWhen(now - 3 * 3_600_000, now), '3 hours ago')
  assert.equal(formatWhen(Date.parse('2026-10-07T12:00:00Z'), now), 'Oct 7')
  assert.equal(formatWhen(Date.parse('2025-03-01T12:00:00Z'), now), 'Mar 1, 2025')
})

test('appFor picks the first app that opens the type', () => {
  const apps = [{ slug: 'photoshop', opens: ['psd', 'png'] }, { slug: 'word', opens: ['docx'] }, { slug: 'powerpoint', opens: ['pptx', 'png'] }]
  assert.equal(appFor(apps, 'a.PNG').slug, 'photoshop')
  assert.equal(appFor(apps, 'a.docx').slug, 'word')
  assert.equal(appFor(apps, 'a.zip'), null)
})
```

- [ ] **Step 4: Run them to verify they fail**

Run: `node --test tests/paths.test.mjs`
Expected: FAIL with `Cannot find module '…/shell/paths.js'`.

- [ ] **Step 5: Write `shell/paths.js`**

```js
// Path, name and format helpers for the browser file store (store.js), the explorer and the apps' bridge.
// Store paths are absolute and slash-separated, without a scheme: '/Reports/budget.xlsx'. Apps see the same
// file as 'browser:/Reports/budget.xlsx', so their patches (patches/*.yaml) can tell store paths from others.

export const SCHEME = 'browser:'

/** '/a//b/./c/' → '/a/b/c'. '..' segments are dropped: there is nothing above the store's root. */
export const normalize = (path) =>
  '/' + String(path).split(/[\\/]+/).filter((part) => part && part !== '.' && part !== '..').join('/')

export const toAppPath = (path) => SCHEME + normalize(path)
/** The store path inside an app path, or null for anything that isn't one. */
export const fromAppPath = (appPath) =>
  typeof appPath === 'string' && appPath.startsWith(SCHEME) ? normalize(appPath.slice(SCHEME.length)) : null

export const baseName = (path) => normalize(path).split('/').at(-1)
export const parentOf = (path) => normalize(normalize(path).split('/').slice(0, -1).join('/'))
export const join = (dir, name) => normalize(`${dir}/${name}`)
/** Every folder from the root down to `path`, for the breadcrumb: ['/', '/a', '/a/b']. */
export const ancestry = (path) => {
  const parts = normalize(path).split('/').filter(Boolean)
  return ['/', ...parts.map((_, i) => '/' + parts.slice(0, i + 1).join('/'))]
}

export const extOf = (name) => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}
/** A name a user may give a file or folder: not blank, no separators or characters other systems reject. */
export const validName = (name) => {
  const n = name.trim()
  return n !== '' && n !== '.' && n !== '..' && !/[\\/:*?"<>|\u0000-\u001f]/.test(n)
}
export const matchesTypes = (name, types) => !types?.length || types.includes(extOf(name))
/** `name` with the first of `types` added when it has none of them: 'Budget' → 'Budget.xlsx'. */
export const withType = (name, types) => (types?.length && !types.includes(extOf(name)) ? `${name}.${types[0]}` : name)
/** 'Report.docx' when free, else 'Report (2).docx', 'Report (3).docx', … */
export const uniqueName = (name, taken) => {
  if (!taken.has(name)) return name
  const ext = extOf(name)
  const stem = ext ? name.slice(0, -ext.length - 1) : name
  for (let i = 2; ; i++) {
    const candidate = ext ? `${stem} (${i}).${ext}` : `${stem} (${i})`
    if (!taken.has(candidate)) return candidate
  }
}

export const formatSize = (bytes) => {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let n = bytes / 1000
  let u = 0
  while (n >= 999.5 && u < units.length - 1) {
    n /= 1000
    u++
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[u]}`
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const thisYear = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const otherYear = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
/** 'just now', '5 minutes ago', '3 hours ago', then 'Oct 7' (this year) or 'Mar 1, 2025'. */
export const formatWhen = (ms, now = Date.now()) => {
  const s = (now - ms) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return relative.format(-Math.floor(s / 60), 'minute')
  if (s < 86400) return relative.format(-Math.floor(s / 3600), 'hour')
  return (new Date(ms).getUTCFullYear() === new Date(now).getUTCFullYear() ? thisYear : otherYear).format(ms)
}

/** The app (from /shell/apps.json) that opens a file of this name, or null. */
export const appFor = (apps, name) => apps.find((app) => app.opens?.includes(extOf(name))) ?? null
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/paths.test.mjs`
Expected: all 8 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tests/helpers.mjs tests/paths.test.mjs shell/paths.js
git commit -m "Add the shell's path helpers and a browser test harness" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The browser file store

**Files:**
- Create: `shell/store.js`, `tests/store.test.mjs`
- Modify: `vite.config.js` (only the `/shell/` dev middleware, so tests can import the module; Task 3 extends it)

**Interfaces:**
- Consumes: `shell/paths.js` (Task 1).
- Produces `shell/store.js` (all paths are store paths like `/a/b.txt`):
  - `available() → Promise<boolean>`
  - `list(dir) → Promise<Entry[]>`, where `Entry = { name, path, kind: 'file'|'folder', size?, modified? }`. Folders come first, then names in natural order.
  - `stat(path) → Promise<{kind, size?, modified?} | null>`
  - `read(path) → Promise<Uint8Array>`
  - `write(path, data: Uint8Array|Blob) → Promise<void>`: queued per path; parent folders are created.
  - `pendingWrites() → number`
  - `mkdir(path)`
  - `remove(path)`: recursive.
  - `move(from, to)`: throws if `to` exists or is inside `from`.
  - `usage() → Promise<{ usage, quota }>`
  - `persist() → Promise<boolean>`
  - `onChange(fn(dir)) → unsubscribe`: fires for this tab's and other tabs' changes, with the folder that changed.

- [ ] **Step 1: Serve `shell/` at `/shell/` in the dev server**

In `vite.config.js`, change the first import line to:

```js
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
```

Add above `export default defineConfig`:

```js
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }
// The shell (top bar, file explorer, browser file storage: the shell/ folder) at /shell/, for the app pages
// and /files/. Served as-is, not through Vite's module pipeline, exactly as the built site serves it.
const shell = (req, res, next) => {
  const path = req.url.split('?')[0]
  if (!path.startsWith('/shell/')) return next()
  const name = path.slice('/shell/'.length)
  const file = join('shell', name)
  if (name.includes('..') || !existsSync(file)) return next()
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
  res.end(readFileSync(file))
}
```

And register it before `toolIndex`:

```js
      configureServer: (server) => {
        server.middlewares.use(shell)
        server.middlewares.use(toolIndex)
      },
```

- [ ] **Step 2: Write the failing tests `tests/store.test.mjs`**

```js
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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test tests/store.test.mjs`
Expected: FAIL. The pages' dynamic `import('/shell/store.js')` rejects ("Failed to fetch dynamically imported module").

- [ ] **Step 4: Write `shell/store.js`**

```js
// The browser file store behind the Files explorer and the apps' Save / Open: the origin private file system
// (OPFS), in a folder of its own (Lightroom's library and After Effects' store share the origin's OPFS).
// Paths are store paths ('/Reports/budget.xlsx', see paths.js). Changes are announced to this tab's
// listeners and, through a BroadcastChannel, to other tabs, with the folder that changed.
import { baseName, join, normalize, parentOf } from './paths.js'

const FOLDER = 'playground-files'
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('playground-files') : null
const listeners = new Set()
const changed = (dir) => {
  for (const fn of listeners) fn(dir)
  channel?.postMessage(dir)
}
channel?.addEventListener('message', (e) => {
  for (const fn of listeners) fn(e.data)
})
export const onChange = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let rootHandle
const root = () => (rootHandle ??= navigator.storage.getDirectory().then((d) => d.getDirectoryHandle(FOLDER, { create: true })))

/** False where the browser blocks its file storage (e.g. some private windows). */
export const available = async () => {
  try {
    await root()
    return true
  } catch {
    rootHandle = undefined
    return false
  }
}

const folder = async (path, create = false) => {
  let dir = await root()
  for (const part of normalize(path).split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create })
  return dir
}

export const list = async (path) => {
  const entries = []
  for await (const [name, handle] of (await folder(path)).entries()) {
    if (handle.kind === 'directory') {
      entries.push({ name, path: join(path, name), kind: 'folder' })
    } else {
      const file = await handle.getFile()
      entries.push({ name, path: join(path, name), kind: 'file', size: file.size, modified: file.lastModified })
    }
  }
  const order = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
  return entries.sort((a, b) => (a.kind === b.kind ? order.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1))
}

export const stat = async (path) => {
  if (normalize(path) === '/') return { kind: 'folder' }
  try {
    const dir = await folder(parentOf(path))
    try {
      const file = await (await dir.getFileHandle(baseName(path))).getFile()
      return { kind: 'file', size: file.size, modified: file.lastModified }
    } catch {
      await dir.getDirectoryHandle(baseName(path))
      return { kind: 'folder' }
    }
  } catch {
    return null
  }
}

export const read = async (path) => {
  const file = await (await (await folder(parentOf(path))).getFileHandle(baseName(path))).getFile()
  return new Uint8Array(await file.arrayBuffer())
}

// Apps write synchronously and move on (their write hooks can't wait), so writes queue per path and land
// in order; pendingWrites() lets the page warn before it is closed with writes still in flight.
const queues = new Map()
let pending = 0
export const pendingWrites = () => pending
export const write = (path, data) => {
  path = normalize(path)
  pending++
  const task = (queues.get(path) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const handle = await (await folder(parentOf(path), true)).getFileHandle(baseName(path), { create: true })
      if (!handle.createWritable) throw new Error("This browser can't write to its file storage")
      const out = await handle.createWritable()
      try {
        await out.write(data)
        await out.close()
      } catch (e) {
        await out.abort?.().catch(() => {})
        throw e
      }
      changed(parentOf(path))
    })
    .finally(() => {
      pending--
      if (queues.get(path) === task) queues.delete(path)
    })
  queues.set(path, task)
  return task
}

export const mkdir = async (path) => {
  await folder(path, true)
  changed(parentOf(path))
}

export const remove = async (path) => {
  await (await folder(parentOf(path))).removeEntry(baseName(path), { recursive: true })
  changed(parentOf(path))
}

const copy = async (from, to) => {
  const info = await stat(from)
  if (!info) throw new Error(`${baseName(from)} doesn't exist`)
  if (info.kind === 'file') return write(to, await read(from))
  await mkdir(to)
  for (const entry of await list(from)) await copy(entry.path, join(to, entry.name))
}

/** Move or rename a file or folder (copy, then delete: OPFS has no portable move). */
export const move = async (from, to) => {
  from = normalize(from)
  to = normalize(to)
  if (from === to) return
  if (to.startsWith(`${from}/`)) throw new Error(`${baseName(from)} can't move into itself`)
  if (await stat(to)) throw new Error(`${baseName(to)} already exists there`)
  await copy(from, to)
  await remove(from)
}

export const usage = async () => {
  const { usage = 0, quota = 0 } = (await navigator.storage.estimate?.()) ?? {}
  return { usage, quota }
}
/** Ask the browser not to clear the storage when the disk runs low. */
export const persist = () => navigator.storage.persist?.().catch(() => false) ?? Promise.resolve(false)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/store.test.mjs`
Expected: all 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add shell/store.js tests/store.test.mjs vite.config.js
git commit -m "Add the browser file store (OPFS) for the shell" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The app list (`/shell/apps.json`) and shipping the shell in the build

**Files:**
- Modify: `vite.config.js`, `tools.yaml`
- Create: `tests/shell.test.mjs`

**Interfaces:**
- Consumes: the `installed(t, channel)` helper already in `vite.config.js`, and `public/<slug>/.release` stamps written by `scripts/fetch.mjs`, as `{ path, tag, label, date, … }`.
- Produces `/shell/apps.json`:

  ```
  { groups: [{ name, apps: [{ slug, name, blurb, accent, icon, opens: string[],
                              release: {path,label,date}|null, head: {path,label,date}|null }] }] }
  ```

  - `icon` is `<install path>site-icon.<ext>`; fetch.mjs copies it into every install.
  - Only installed apps are listed, and groups with none are dropped.
  - In the build it is written to `dist/shell/apps.json`, next to a copy of `shell/`.

- [ ] **Step 1: Write the failing test `tests/shell.test.mjs`**

```js
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { launch, startSite } from './helpers.mjs'

let site, browser
before(async () => {
  site = await startSite()
  browser = await launch()
})
after(async () => {
  await browser?.close()
  await site?.close()
})

test('/shell/apps.json lists the installed apps with their channels and file types', async () => {
  const data = await (await fetch(`${site.url}/shell/apps.json`)).json()
  const apps = data.groups.flatMap((g) => g.apps)
  assert.ok(apps.length >= 3, 'run `make fetch` first: the tests use the installed apps')
  const word = apps.find((a) => a.slug === 'word')
  assert.equal(word.name, 'Word')
  assert.match(word.icon, /^\/(head\/)?word\/site-icon\.svg$/)
  assert.ok(word.opens.includes('docx'))
  const build = word.release ?? word.head
  assert.match(build.path, /^\/(head\/)?word\/$/)
  assert.equal(typeof build.label, 'string')
  for (const g of data.groups) assert.ok(g.apps.length > 0, `group ${g.name} is empty`)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/shell.test.mjs`
Expected: FAIL. `/shell/apps.json` is a 404 (the shell middleware finds no such file), so `.json()` throws.

- [ ] **Step 3: Add `opens:` to every tool in `tools.yaml`**

First document the key: add this line to the key list in the header comment, after the `patches:` lines:

```yaml
#   opens:  file types (extensions) the app opens: the Files explorer shows its icon on them and opens them in it
```

Then add an `opens:` line to each tool, directly after its `blurb:` line:

| slug | `opens:` |
|---|---|
| photoshop | `[psd, psb, pcraft, png, jpg, jpeg, webp, gif, bmp, tif, tiff]` |
| illustrator | `[vectorcraft, ai, svg, eps]` |
| indesign | `[designcraft, idml]` |
| lightroom | `[dng, cr2, cr3, nef, arw, raf, orf, rw2]` |
| premiere | `[fcproj, mp4, mov, m4v, webm]` |
| after-effects | `[ecproj, ecprojx]` |
| acrobat | `[pdf]` |
| word | `[docx, docm, dotx, odt, rtf, txt, md]` |
| excel | `[xlsx, xlsm, csv, tsv]` |
| powerpoint | `[pptx, potx, ppsx, deckcraft]` |
| autocad | `[dxf, dwg]` |
| pro-tools | `[scraft, wav, mp3, flac, ogg, aif, aiff, m4a]` |

For example, the Word entry becomes:

```yaml
      - slug: word
        name: Word
        blurb: Writing and document design.
        opens: [docx, docm, dotx, odt, rtf, txt, md]
        repo: storytold/wordcraft
```

- [ ] **Step 4: Generate apps.json in `vite.config.js`, in dev and in the build**

Change the imports at the top to:

```js
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
```

Add below `renderGroups`:

```js
// /shell/apps.json: what the shell's app switcher and file explorer list, from tools.yaml and the installed
// builds (the same stamps the dashboard reads). An app's icon is its install's site-icon (fetch.mjs copies it).
const appsJson = () => ({
  groups: parse(readFileSync('tools.yaml', 'utf8'))
    .groups.map((g) => ({
      name: g.name,
      apps: g.tools.flatMap((t) => {
        const release = installed(t, 'release')
        const head = installed(t, 'head')
        if (!release && !head) return []
        const channel = (s) => s && { path: s.path, label: s.label, date: s.date ?? null }
        return [{
          slug: t.slug, name: t.name, blurb: t.blurb, accent: t.accent, opens: t.opens ?? [],
          icon: `${(release ?? head).path}site-icon${extname(t.icon)}`,
          release: channel(release) ?? null, head: channel(head) ?? null,
        }]
      }),
    }))
    .filter((g) => g.apps.length),
})
```

In the `shell` middleware, answer apps.json before the file lookup. The middleware becomes:

```js
const shell = (req, res, next) => {
  const path = req.url.split('?')[0]
  if (!path.startsWith('/shell/')) return next()
  const name = path.slice('/shell/'.length)
  if (name === 'apps.json') {
    res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-cache' })
    return res.end(JSON.stringify(appsJson()))
  }
  const file = join('shell', name)
  if (name.includes('..') || !existsSync(file)) return next()
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
  res.end(readFileSync(file))
}
```

Add a second plugin to the `plugins` array, after the `tools` plugin:

```js
    {
      // The built site serves the shell as plain files, like the dev middleware above.
      name: 'shell',
      apply: 'build',
      closeBundle() {
        cpSync('shell', 'dist/shell', { recursive: true })
        writeFileSync('dist/shell/apps.json', JSON.stringify(appsJson()))
      },
    },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/shell.test.mjs`
Expected: PASS.

- [ ] **Step 6: Check the build ships the shell**

Run: `npm run build && ls dist/shell && node -e "const d=require('./dist/shell/apps.json'); console.log(d.groups.map(g=>g.name+':'+g.apps.length).join(' '))"`
Expected:
- `paths.js`, `store.js` and `apps.json` are listed.
- One line of group counts follows, e.g. `Adobe Creative Cloud:7 Microsoft Office:3 Other:2`.

- [ ] **Step 7: Commit**

```bash
git add vite.config.js tools.yaml tests/shell.test.mjs
git commit -m "Serve the app list for the shell at /shell/apps.json and ship shell/ in the build" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The explorer and the Files page

**Files:**
- Create: `shell/ui.js`, `shell/apps.js`, `shell/explorer.js`, `shell/shell.css`, `shell/files-page.js`, `files/index.html`, `tests/explorer.test.mjs`
- Modify: `vite.config.js` (build inputs), `index.html` (dashboard **Files** link)

**Interfaces:**
- Consumes: `paths.js` (Task 1), `store.js` (Task 2), `/shell/apps.json` (Task 3).
- Produces `shell/ui.js`:
  - `h(tag, props, ...children)`
  - `icon(name)`, with names `folder file newFolder upload download more chevron check expand shrink files computer browser close`
  - `isolate(el) → el`: stops key, text and clipboard events at `el`, so they don't reach the app's document listeners
  - `modal(build, { label, className }) → Promise<result>`: `build(done)` returns `{ el, focus?, destroy? }`; Esc resolves `null`.
  - `toast(message, actions?: {label, run}[]) → close()`
  - `confirmIn(container, message, confirmLabel, { danger }) → Promise<boolean>`
  - `download(name, Uint8Array|Blob)`
- Produces `shell/apps.js`:
  - `loadApps() → Promise<{groups}>`
  - `flatApps(data) → app[]`
  - `currentApp(pathname?) → { slug, channel: 'release'|'head' } | null`
  - `appHref(app) → path`, following the dashboard's `localStorage.channel`
- Produces `shell/explorer.js`: `explorer({ mode, types, name, apps, closable, onDone, onOpenInApp }) → { el, ready: Promise, focus(), destroy() }`
  - `mode`: `'browse' | 'open' | 'save'`
  - `onDone` receives:
    - open: a store path, or `{ computer: File }`;
    - save: a store path;
    - browse: `null` (from the Close button);
    - `null` on Cancel.
  - `onOpenInApp(path, app)`
- Produces `shell/files-page.js`: `mountFilesPage(container)`.

- [ ] **Step 1: Write `shell/ui.js`**

```js
// Small DOM helpers shared by the shell's top bar, explorer and dialogs.

/** h('button', { class: 'x', onclick }, 'Label', child) → element. `true` sets a boolean attribute. */
export const h = (tag, props = {}, ...children) => {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value)
    else if (key === 'class') el.className = value
    else el.setAttribute(key, value === true ? '' : value)
  }
  el.append(...children.flat().filter((c) => c != null && c !== false))
  return el
}

const FOLDER = '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h9A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>'
const ICONS = {
  folder: FOLDER,
  files: FOLDER,
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  newFolder: `${FOLDER}<path d="M12 10.5v5M9.5 13h5"/>`,
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6 6.5h.01M8.5 6.5h.01"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
}
export const icon = (name) => {
  const span = h('span', { class: 'pg-icon', 'aria-hidden': 'true' })
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
  return span
}

// Keys, text and clipboard events inside shell UI stop here: the app under it (eframe) listens on document.
const KEPT = ['keydown', 'keyup', 'keypress', 'input', 'paste', 'copy', 'cut', 'compositionstart', 'compositionupdate', 'compositionend']
export const isolate = (el) => {
  for (const type of KEPT) el.addEventListener(type, (e) => e.stopPropagation())
  return el
}

/**
 * Show `build(done)`'s view in a modal dialog; resolves with the value passed to done(), or null on Esc.
 * build returns { el, focus?, destroy? }.
 */
export const modal = (build, { label, className = '' } = {}) =>
  new Promise((resolve) => {
    const dialog = isolate(h('dialog', { class: `pg-modal ${className}`.trim(), 'aria-label': label }))
    let view
    const done = (value) => {
      if (!dialog.isConnected) return
      dialog.close()
      view?.destroy?.()
      dialog.remove()
      resolve(value ?? null)
    }
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault()
      done(null)
    })
    view = build(done)
    dialog.append(view.el)
    document.body.append(dialog)
    dialog.showModal()
    view.focus?.()
  })

/** A notice in the bottom corner. With actions it stays until used or dismissed; without, for 5 s. */
export const toast = (message, actions = []) => {
  let host = document.querySelector('.pg-toasts')
  if (!host) {
    host = isolate(h('div', { class: 'pg-toasts', role: 'status', 'aria-live': 'polite' }))
    document.body.append(host)
  }
  const close = () => el.remove()
  const el = h(
    'div',
    { class: 'pg-toast' },
    h('span', {}, message),
    actions.map(({ label, run }) => h('button', { class: 'pg-btn', type: 'button', onclick: () => (run(), close()) }, label)),
    h('button', { class: 'pg-btn pg-quiet', type: 'button', 'aria-label': 'Dismiss', onclick: close }, icon('close')),
  )
  host.append(el)
  if (!actions.length) setTimeout(close, 5000)
  return close
}

/** Ask inside `container` (positioned): resolves true for the confirm button, false for Cancel or Esc. */
export const confirmIn = (container, message, confirmLabel, { danger = false } = {}) =>
  new Promise((resolve) => {
    const finish = (value) => {
      box.remove()
      resolve(value)
    }
    const ok = h('button', { class: `pg-btn ${danger ? 'pg-danger' : 'pg-primary'}`, type: 'button', onclick: () => finish(true) }, confirmLabel)
    const box = h(
      'div',
      {
        class: 'pg-confirm',
        role: 'alertdialog',
        'aria-label': message,
        onkeydown: (e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          e.stopPropagation()
          finish(false)
        },
      },
      h('div', { class: 'pg-confirm-card' }, h('p', {}, message), h('div', { class: 'pg-actions' }, h('button', { class: 'pg-btn', type: 'button', onclick: () => finish(false) }, 'Cancel'), ok)),
    )
    container.append(box)
    ok.focus()
  })

/** Hand bytes to the browser as a download named `name`. */
export const download = (name, data) => {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]))
  const a = h('a', { href: url, download: name, hidden: true })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
```

- [ ] **Step 2: Write `shell/apps.js`**

```js
// The site's apps, from /shell/apps.json (vite.config.js builds it from tools.yaml and the installed builds).

let data
/** { groups: [{ name, apps: [{ slug, name, blurb, accent, icon, opens, release, head }] }] } */
export const loadApps = () =>
  (data ??= fetch('/shell/apps.json')
    .then((r) => (r.ok ? r.json() : { groups: [] }))
    .catch(() => ({ groups: [] })))

export const flatApps = ({ groups }) => groups.flatMap((g) => g.apps)

/** The app page this is ('/word/' or '/head/word/'): { slug, channel }, or null on other pages. */
export const currentApp = (pathname = location.pathname) => {
  const m = pathname.match(/^\/(?:(head)\/)?([^/]+)\//)
  return m && !['files', 'shell'].includes(m[2]) ? { slug: m[2], channel: m[1] ? 'head' : 'release' } : null
}

// The dashboard's "Use latest commits" switch (index.html) keeps its choice in localStorage.channel.
const preferred = () => {
  try {
    return localStorage.getItem('channel')
  } catch {
    return null
  }
}
/** An app's page in the preferred channel, else the one it has. */
export const appHref = (app) => ((preferred() === 'head' && app.head) || app.release || app.head).path
```

- [ ] **Step 3: Write `shell/explorer.js`**

```js
// The file explorer: a folder view of the browser file store (store.js) in three modes. 'browse' is the
// Files popup in apps and the /files/ page; 'open' is an app's Open; 'save' is an app's Save As (step 2,
// after files.js asks "Keep in browser storage / Download to device").
import * as store from './store.js'
import { ancestry, appFor, baseName, formatSize, formatWhen, join, matchesTypes, parentOf, uniqueName, validName, withType } from './paths.js'
import { confirmIn, download, h, icon } from './ui.js'

const DRAG = 'application/x-playground-path'
const LAST_DIR = 'pg-files-dir'
const remember = (dir) => {
  try {
    localStorage.setItem(LAST_DIR, dir)
  } catch {}
}
const remembered = () => {
  try {
    return localStorage.getItem(LAST_DIR)
  } catch {
    return null
  }
}
const rowId = (path) => `pg-row-${encodeURIComponent(path)}`

/**
 * explorer({ mode, types, name, apps, closable, onDone, onOpenInApp }) → { el, ready, focus(), destroy() }
 * - mode: 'browse' | 'open' | 'save'
 * - types: extensions; open mode lists only these (with an "All files" switch), save mode adds the first to a
 *   name that has none of them
 * - name: the suggested name in save mode
 * - apps: the flat app list (apps.js), for file icons and "Open in app"
 * - closable: browse mode shows a Close button that calls onDone(null)
 * - onDone(result): open → a store path, or { computer: File } for "From computer…"; save → a store path;
 *   null for Cancel / Close
 * - onOpenInApp(path, app): browse mode's "Open in <app>"
 */
export function explorer({ mode = 'browse', types = [], name = '', apps = [], closable = false, onDone = () => {}, onOpenInApp = () => {} }) {
  let dir = '/'
  let entries = []
  let selected = null
  let allTypes = false

  const crumbs = h('nav', { class: 'pg-crumbs', 'aria-label': 'Folder' })
  const uploadInput = h('input', {
    type: 'file',
    multiple: true,
    hidden: true,
    onchange: () => upload([...uploadInput.files], dir).finally(() => (uploadInput.value = '')),
  })
  const head = h(
    'header',
    { class: 'pg-ex-head' },
    crumbs,
    h(
      'div',
      { class: 'pg-ex-tools' },
      h('button', { class: 'pg-btn', type: 'button', onclick: () => newFolder() }, icon('newFolder'), 'New folder'),
      h('button', { class: 'pg-btn', type: 'button', onclick: () => uploadInput.click() }, icon('upload'), 'Upload'),
      uploadInput,
    ),
  )
  const list = h('div', { class: 'pg-ex-list', role: 'listbox', tabindex: '0', 'aria-label': 'Files', onkeydown: onListKey })
  const status = h('p', { class: 'pg-ex-status', role: 'status', 'aria-live': 'polite' })
  const foot = h('footer', { class: 'pg-ex-foot' })
  const root = h('div', { class: 'pg-explorer', 'data-mode': mode }, head, list, status, foot)

  // Mode footers.
  let nameInput = null
  let openButton = null
  if (mode === 'open') {
    const pick = h('input', {
      type: 'file',
      hidden: true,
      accept: types.map((t) => `.${t}`).join(','),
      onchange: () => pick.files[0] && onDone({ computer: pick.files[0] }),
    })
    openButton = h('button', { class: 'pg-btn pg-primary', type: 'button', disabled: true, onclick: () => selectedFile() && onDone(selected) }, 'Open')
    foot.append(
      types.length
        ? h('label', { class: 'pg-check' }, h('input', { type: 'checkbox', onchange: (e) => ((allTypes = e.target.checked), render()) }), 'All files')
        : h('span'),
      h(
        'div',
        { class: 'pg-actions' },
        h('button', { class: 'pg-btn', type: 'button', onclick: () => pick.click() }, icon('computer'), 'From computer…'),
        pick,
        h('button', { class: 'pg-btn', type: 'button', onclick: () => onDone(null) }, 'Cancel'),
        openButton,
      ),
    )
  } else if (mode === 'save') {
    nameInput = h('input', {
      class: 'pg-input',
      type: 'text',
      value: name,
      'aria-label': 'File name',
      spellcheck: 'false',
      autocomplete: 'off',
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          save()
        }
      },
    })
    foot.append(
      h('label', { class: 'pg-name' }, h('span', {}, 'Name'), nameInput),
      h(
        'div',
        { class: 'pg-actions' },
        h('button', { class: 'pg-btn', type: 'button', onclick: () => onDone(null) }, 'Cancel'),
        h('button', { class: 'pg-btn pg-primary', type: 'button', onclick: () => save() }, 'Save'),
      ),
    )
  } else {
    const usage = h('span', { class: 'pg-ex-usage' }, 'Kept in this browser until you clear this site’s data.')
    store.usage().then(({ usage: used }) => {
      if (used) usage.textContent = `This site uses ${formatSize(used)} of browser storage. Files stay until you clear this site’s data.`
    })
    foot.append(usage, closable ? h('button', { class: 'pg-btn', type: 'button', onclick: () => onDone(null) }, 'Close') : null)
  }

  // Listing.
  const visible = () => entries.filter((e) => e.kind === 'folder' || mode !== 'open' || allTypes || matchesTypes(e.name, types))
  const selectedFile = () => entries.find((e) => e.path === selected && e.kind === 'file')

  async function go(path) {
    try {
      entries = await store.list(path)
      if (path !== dir) setStatus('')
      dir = path
      remember(dir)
      if (!entries.some((e) => e.path === selected)) selected = null
      render()
    } catch (e) {
      if (path !== '/') return go('/') // the remembered folder is gone
      showError(e)
    }
  }

  function render() {
    crumbs.replaceChildren(
      ...ancestry(dir).flatMap((path, i, all) => {
        const crumb = h('button', { class: 'pg-crumb', type: 'button', 'aria-current': i === all.length - 1 ? 'location' : null, onclick: () => go(path) }, path === '/' ? 'Files' : baseName(path))
        dropTarget(crumb, () => path)
        return i ? [h('span', { class: 'pg-sep', 'aria-hidden': 'true' }, '›'), crumb] : [crumb]
      }),
    )
    const rows = visible()
    list.replaceChildren(...rows.map(row))
    if (!rows.length) {
      list.append(h('p', { class: 'pg-ex-empty' }, mode === 'open' && entries.length ? 'No files of this type here.' : 'This folder is empty. Drop files here to upload them.'))
    }
    list.setAttribute('aria-activedescendant', selected && rows.some((r) => r.path === selected) ? rowId(selected) : '')
    if (openButton) openButton.disabled = !selectedFile()
  }

  function row(entry) {
    const app = entry.kind === 'file' ? appFor(apps, entry.name) : null
    const el = h(
      'div',
      {
        class: 'pg-row',
        role: 'option',
        id: rowId(entry.path),
        'aria-selected': String(entry.path === selected),
        draggable: 'true',
        'data-path': entry.path,
        onclick: () => select(entry.path),
        ondblclick: () => activate(entry),
        oncontextmenu: (e) => {
          if (mode !== 'browse') return
          e.preventDefault()
          select(entry.path)
          menu(entry, e.clientX, e.clientY)
        },
        ondragstart: (e) => {
          e.dataTransfer.setData(DRAG, entry.path)
          e.dataTransfer.effectAllowed = 'move'
        },
      },
      app ? h('img', { class: 'pg-row-icon', src: app.icon, alt: '' }) : icon(entry.kind === 'folder' ? 'folder' : 'file'),
      h('span', { class: 'pg-row-name' }, entry.name),
      h('span', { class: 'pg-row-size' }, entry.kind === 'folder' ? 'Folder' : formatSize(entry.size)),
      h('span', { class: 'pg-row-when' }, entry.modified ? formatWhen(entry.modified) : ''),
      mode === 'browse'
        ? h(
            'button',
            {
              class: 'pg-row-more',
              type: 'button',
              'aria-label': `Actions for ${entry.name}`,
              onclick: (e) => {
                e.stopPropagation()
                select(entry.path)
                const r = e.currentTarget.getBoundingClientRect()
                menu(entry, r.right, r.bottom)
              },
            },
            icon('more'),
          )
        : null,
    )
    if (entry.kind === 'folder') dropTarget(el, () => entry.path)
    return el
  }

  function select(path) {
    selected = path
    for (const el of list.querySelectorAll('.pg-row')) el.setAttribute('aria-selected', String(el.dataset.path === path))
    list.setAttribute('aria-activedescendant', path ? rowId(path) : '')
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    const file = selectedFile()
    if (nameInput && file) nameInput.value = file.name
    if (openButton) openButton.disabled = !file
  }

  function activate(entry) {
    if (entry.kind === 'folder') return go(entry.path)
    if (mode === 'open') return onDone(entry.path)
    if (mode === 'save') {
      nameInput.value = entry.name
      return save()
    }
    const app = appFor(apps, entry.name)
    if (app) onOpenInApp(entry.path, app)
    else downloadEntry(entry)
  }

  function onListKey(e) {
    if (e.target !== list) return // keys typed while renaming belong to the rename field
    const rows = visible()
    const i = rows.findIndex((r) => r.path === selected)
    const to = (j) => {
      e.preventDefault()
      if (rows.length) select(rows[Math.max(0, Math.min(rows.length - 1, j))].path)
    }
    if (e.key === 'ArrowDown') to(i + 1)
    else if (e.key === 'ArrowUp') to(i < 0 ? 0 : i - 1)
    else if (e.key === 'Home') to(0)
    else if (e.key === 'End') to(rows.length - 1)
    else if (e.key === 'Enter' && i >= 0) {
      e.preventDefault()
      activate(rows[i])
    } else if (e.key === 'Backspace' && dir !== '/') {
      e.preventDefault()
      go(parentOf(dir))
    } else if (e.key === 'Delete' && i >= 0) {
      e.preventDefault()
      remove(rows[i])
    } else if (e.key === 'F2' && i >= 0) {
      e.preventDefault()
      rename(rows[i])
    } else if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && i >= 0 && mode === 'browse') {
      e.preventDefault()
      const r = document.getElementById(rowId(rows[i].path)).getBoundingClientRect()
      menu(rows[i], r.left + 40, r.bottom)
    }
  }

  // Browse mode's row menu, at viewport point (x, y).
  function menu(entry, x, y) {
    root.querySelector('.pg-menu')?.remove()
    const app = entry.kind === 'file' ? appFor(apps, entry.name) : null
    const item = (label, run) => h('button', { class: 'pg-menu-item', role: 'menuitem', type: 'button', onclick: () => (close(), run()) }, label)
    const items = [
      entry.kind === 'folder' ? item('Open', () => go(entry.path)) : app && item(`Open in ${app.name}`, () => onOpenInApp(entry.path, app)),
      entry.kind === 'file' && item('Download', () => downloadEntry(entry)),
      item('Rename', () => rename(entry)),
      item('Delete', () => remove(entry)),
    ].filter(Boolean)
    const el = h(
      'div',
      {
        class: 'pg-menu',
        role: 'menu',
        onkeydown: (e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          e.stopPropagation()
          close()
          list.focus()
        },
      },
      items,
    )
    const outside = (e) => !el.contains(e.target) && close()
    const close = () => {
      el.remove()
      removeEventListener('pointerdown', outside, true)
    }
    root.append(el)
    const box = root.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(x - box.left, box.width - el.offsetWidth - 8))}px`
    el.style.top = `${Math.max(8, Math.min(y - box.top, box.height - el.offsetHeight - 8))}px`
    addEventListener('pointerdown', outside, true)
    items[0]?.focus()
  }

  // Actions.
  async function guard(task) {
    try {
      return await task()
    } catch (e) {
      showError(e)
    }
  }
  function setStatus(text) {
    status.textContent = text
    status.classList.remove('pg-error')
  }
  function showError(e) {
    console.error(e)
    status.textContent = e?.message ?? String(e)
    status.classList.add('pg-error')
  }

  async function newFolder() {
    const folderName = uniqueName('New folder', new Set(entries.map((e) => e.name)))
    await guard(() => store.mkdir(join(dir, folderName)))
    await go(dir)
    const entry = entries.find((e) => e.name === folderName)
    if (entry) {
      select(entry.path)
      rename(entry)
    }
  }

  async function upload(files, into) {
    if (!files.length) return
    const taken = new Set((into === dir ? entries : await store.list(into)).map((e) => e.name))
    for (const file of files) {
      const fileName = uniqueName(file.name, taken)
      taken.add(fileName)
      await guard(() => store.write(join(into, fileName), file))
    }
    setStatus(`Uploaded ${files.length === 1 ? files[0].name : `${files.length} files`}.`)
  }

  const downloadEntry = (entry) => guard(async () => download(entry.name, await store.read(entry.path)))

  function rename(entry) {
    const cell = document.getElementById(rowId(entry.path))?.querySelector('.pg-row-name')
    if (!cell) return
    const input = h('input', { class: 'pg-input pg-rename', value: entry.name, 'aria-label': `New name for ${entry.name}`, spellcheck: 'false' })
    cell.replaceChildren(input)
    input.focus()
    const dot = entry.kind === 'file' ? entry.name.lastIndexOf('.') : -1
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length)
    let finished = false
    const finish = async (commit) => {
      if (finished) return
      finished = true
      const next = input.value.trim()
      if (!commit || next === entry.name) return render(), list.focus()
      if (!validName(next)) return showError(new Error(`“${next}” isn’t a valid name.`)), render(), list.focus()
      if (entries.some((e) => e.name === next)) return showError(new Error(`${next} already exists here.`)), render(), list.focus()
      selected = join(dir, next)
      await guard(() => store.move(entry.path, selected))
      await go(dir)
      list.focus()
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
      }
    })
    input.addEventListener('blur', () => finish(true))
    for (const type of ['click', 'dblclick']) input.addEventListener(type, (e) => e.stopPropagation())
  }

  async function remove(entry) {
    const what = entry.kind === 'folder' ? `the folder ${entry.name} and everything in it` : entry.name
    if (await confirmIn(root, `Delete ${what}? This can’t be undone.`, 'Delete', { danger: true })) await guard(() => store.remove(entry.path))
    list.focus()
  }

  async function save() {
    const typed = nameInput.value.trim()
    if (!validName(typed)) {
      showError(new Error(typed ? `“${typed}” isn’t a valid file name.` : 'Type a name for the file.'))
      return nameInput.focus()
    }
    const fileName = withType(typed, types)
    const existing = entries.find((e) => e.name === fileName)
    if (existing?.kind === 'folder') return showError(new Error(`There’s a folder named ${fileName} here.`))
    if (existing && !(await confirmIn(root, `Replace ${fileName}?`, 'Replace'))) return nameInput.focus()
    onDone(join(dir, fileName))
  }

  // Drops: rows dragged onto a folder or a breadcrumb move there; files from the computer upload there.
  function dropTarget(el, target) {
    el.addEventListener('dragover', (e) => {
      const kinds = e.dataTransfer.types
      if (!kinds.includes(DRAG) && !kinds.includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = kinds.includes(DRAG) ? 'move' : 'copy'
      el.classList.add('pg-drop')
    })
    el.addEventListener('dragleave', () => el.classList.remove('pg-drop'))
    el.addEventListener('drop', (e) => {
      el.classList.remove('pg-drop')
      const from = e.dataTransfer.getData(DRAG)
      if (!from && !e.dataTransfer.files.length) return
      e.preventDefault()
      e.stopPropagation()
      const into = target()
      if (!from) return upload([...e.dataTransfer.files], into)
      if (from !== into && parentOf(from) !== into) guard(() => store.move(from, join(into, baseName(from))))
    })
  }
  dropTarget(list, () => dir)

  const unsubscribe = store.onChange((changed) => changed === dir && go(dir))
  const ready = store.available().then((ok) => {
    if (ok) return go(remembered() ?? '/')
    head.hidden = true
    list.replaceChildren(h('p', { class: 'pg-ex-empty' }, 'Browser storage isn’t available in this window (for example, a private window).'))
  })
  return {
    el: root,
    ready,
    focus() {
      if (!nameInput) return list.focus()
      nameInput.focus()
      const dot = nameInput.value.lastIndexOf('.')
      nameInput.setSelectionRange(0, dot > 0 ? dot : nameInput.value.length)
    },
    destroy: unsubscribe,
  }
}
```

- [ ] **Step 4: Write `shell/shell.css`**

```css
/* Playground shell: the bar above every app, the file explorer and its dialogs (shell/*.js). */
@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400;500&display=swap");

:root {
  --pg-bar: 36px;
  --pg-bg: #17181c;
  --pg-panel: #1f2026;
  --pg-raised: #2a2b32;
  --pg-line: #2f313a;
  --pg-text: #ececef;
  --pg-muted: #91939c;
  --pg-accent: #7aa7ff;
  --pg-on-accent: #0d1424;
  --pg-warn: #f5a524;
  --pg-danger: #ff6b70;
  --pg-select: color-mix(in srgb, var(--pg-accent) 20%, transparent);
  --pg-shadow: 0 18px 50px rgb(0 0 0 / 0.45);
  --pg-font: "Geist", system-ui, sans-serif;
  --pg-mono: "Geist Mono", ui-monospace, monospace;
}
@media (prefers-color-scheme: light) {
  :root {
    --pg-bg: #f4f4f6;
    --pg-panel: #ffffff;
    --pg-raised: #ececf0;
    --pg-line: #dedee4;
    --pg-text: #1b1c20;
    --pg-muted: #62646d;
    --pg-accent: #2563eb;
    --pg-on-accent: #ffffff;
    --pg-danger: #d1343b;
    --pg-shadow: 0 18px 50px rgb(20 20 40 / 0.18);
  }
}

/* App pages: the app's canvas (always the first canvas in <body>) sits below the bar. */
body > canvas:first-of-type {
  position: fixed !important;
  inset: var(--pg-bar) 0 0 0 !important;
  width: 100% !important;
  height: calc(100% - var(--pg-bar)) !important;
}

.pg-icon { display: inline-grid; place-items: center; width: 16px; height: 16px; flex: none; }
.pg-icon svg { width: 100%; height: 100%; }

/* The bar */
.pg-bar {
  position: fixed; inset: 0 0 auto 0; height: var(--pg-bar); z-index: 2147483000;
  display: flex; align-items: center; gap: 4px; padding: 0 8px; box-sizing: border-box;
  background: var(--pg-bg); border-bottom: 1px solid var(--pg-line); color: var(--pg-text);
  font: 500 13px/1 var(--pg-font); -webkit-font-smoothing: antialiased; user-select: none;
}
.pg-bar a, .pg-bar button { color: inherit; font: inherit; }
.pg-home, .pg-switch, .pg-bar-btn {
  display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 9px;
  border: 0; border-radius: 7px; background: transparent; text-decoration: none; cursor: pointer; white-space: nowrap;
}
.pg-home { font-weight: 600; letter-spacing: -0.01em; }
.pg-mark { width: 13px; height: 13px; box-sizing: border-box; border-radius: 50%; border: 1.5px solid currentColor; background: linear-gradient(90deg, currentColor 50%, transparent 50%); }
.pg-switch img { width: 18px; height: 18px; border-radius: 4px; }
.pg-switch .pg-icon { width: 14px; height: 14px; color: var(--pg-muted); }
.pg-home:hover, .pg-switch:hover, .pg-bar-btn:hover { background: var(--pg-raised); }
.pg-home:focus-visible, .pg-switch:focus-visible, .pg-bar-btn:focus-visible { outline: 2px solid var(--pg-accent); outline-offset: -2px; }
.pg-version { min-width: 0; padding: 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px var(--pg-mono); color: var(--pg-muted); }
.pg-version.pg-head::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-right: 7px; border-radius: 50%; background: var(--pg-warn); vertical-align: 1px; }
.pg-spacer { flex: 1; }
.pg-apps {
  position: fixed; inset: calc(var(--pg-bar) + 4px) auto auto 8px; margin: 0; box-sizing: border-box;
  width: min(340px, calc(100vw - 16px)); max-height: calc(100vh - var(--pg-bar) - 16px); overflow: auto; padding: 6px;
  border: 1px solid var(--pg-line); border-radius: 12px; background: var(--pg-panel); color: var(--pg-text);
  box-shadow: var(--pg-shadow); font: 13px/1.35 var(--pg-font);
}
.pg-apps-group { margin: 10px 10px 4px; font: 500 11px var(--pg-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--pg-muted); }
.pg-app { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 8px; color: inherit; text-decoration: none; }
.pg-app:hover, .pg-app:focus-visible { background: var(--pg-raised); outline: none; }
.pg-app[aria-current="page"] { background: var(--pg-select); }
.pg-app img { width: 30px; height: 30px; border-radius: 7px; flex: none; }
.pg-app > span { display: grid; flex: 1; min-width: 0; }
.pg-app strong { font-weight: 600; }
.pg-app small { color: var(--pg-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pg-app .pg-icon { color: var(--pg-accent); }
@media (max-width: 560px) {
  .pg-version, .pg-label { display: none; }
}

/* Dialogs */
.pg-modal {
  width: min(820px, calc(100vw - 24px)); height: min(600px, calc(100vh - 24px)); max-width: none; max-height: none;
  padding: 0; border: 1px solid var(--pg-line); border-radius: 14px; background: var(--pg-panel); color: var(--pg-text);
  box-shadow: var(--pg-shadow); font: 14px/1.45 var(--pg-font); -webkit-font-smoothing: antialiased; overflow: hidden;
}
.pg-modal:has(.pg-choice) { width: min(460px, calc(100vw - 24px)); height: auto; }
.pg-modal[open] { display: flex; flex-direction: column; }
.pg-modal > * { flex: 1; min-height: 0; }
.pg-modal::backdrop { background: rgb(0 0 0 / 0.5); }
.pg-btn {
  display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 12px; box-sizing: border-box;
  border: 1px solid var(--pg-line); border-radius: 8px; background: transparent; color: var(--pg-text);
  font: 500 13px var(--pg-font); cursor: pointer; white-space: nowrap;
}
.pg-btn:hover:not(:disabled) { background: var(--pg-raised); }
.pg-btn:disabled { opacity: 0.45; cursor: default; }
.pg-primary { background: var(--pg-accent); border-color: transparent; color: var(--pg-on-accent); }
.pg-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--pg-accent) 85%, white); }
.pg-danger { background: var(--pg-danger); border-color: transparent; color: #fff; }
.pg-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--pg-danger) 85%, black); }
.pg-quiet { border-color: transparent; padding: 0 8px; }
.pg-input { height: 32px; min-width: 0; padding: 0 10px; box-sizing: border-box; border: 1px solid var(--pg-line); border-radius: 8px; background: var(--pg-bg); color: var(--pg-text); font: 14px var(--pg-font); }
.pg-btn:focus-visible, .pg-input:focus-visible, .pg-option:focus-visible, .pg-ex-list:focus-visible, .pg-crumb:focus-visible,
.pg-row-more:focus-visible, .pg-menu-item:focus-visible { outline: 2px solid var(--pg-accent); outline-offset: 1px; }
.pg-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }

/* Explorer */
.pg-explorer { position: relative; display: flex; flex-direction: column; min-height: 0; height: 100%; }
.pg-ex-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--pg-line); }
.pg-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; min-width: 0; }
.pg-crumb { max-width: 220px; padding: 4px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; border-radius: 6px; background: none; color: var(--pg-muted); font: 600 15px var(--pg-font); cursor: pointer; }
.pg-crumb[aria-current] { color: var(--pg-text); }
.pg-crumb:hover, .pg-crumb.pg-drop { background: var(--pg-raised); color: var(--pg-text); }
.pg-sep { color: var(--pg-muted); }
.pg-ex-tools { display: flex; gap: 8px; }
.pg-ex-list { flex: 1; min-height: 160px; overflow: auto; padding: 6px; outline: none; }
.pg-ex-list.pg-drop { box-shadow: inset 0 0 0 2px var(--pg-accent); }
.pg-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) 84px 110px 32px; align-items: center; gap: 10px; height: 38px; padding: 0 8px; border-radius: 8px; cursor: default; }
.pg-explorer:not([data-mode="browse"]) .pg-row { grid-template-columns: 24px minmax(0, 1fr) 84px 110px; }
.pg-row:hover { background: var(--pg-raised); }
.pg-row[aria-selected="true"] { background: var(--pg-select); }
.pg-row.pg-drop { box-shadow: inset 0 0 0 2px var(--pg-accent); }
.pg-row-icon, .pg-row > .pg-icon { width: 22px; height: 22px; border-radius: 5px; color: var(--pg-muted); }
.pg-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pg-row-size, .pg-row-when { color: var(--pg-muted); font-size: 12px; text-align: right; white-space: nowrap; }
.pg-row-more { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 6px; background: none; color: var(--pg-muted); cursor: pointer; opacity: 0; }
.pg-row:hover .pg-row-more, .pg-row[aria-selected="true"] .pg-row-more, .pg-row-more:focus-visible { opacity: 1; }
.pg-row-more:hover { background: var(--pg-line); color: var(--pg-text); }
.pg-rename { width: 100%; height: 28px; }
.pg-ex-empty { margin: 48px 16px; text-align: center; color: var(--pg-muted); }
.pg-ex-status { margin: 0; padding: 0 16px; font-size: 13px; color: var(--pg-muted); }
.pg-ex-status:not(:empty) { padding: 6px 16px; }
.pg-ex-status.pg-error { color: var(--pg-danger); }
.pg-ex-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-top: 1px solid var(--pg-line); }
.pg-ex-usage { color: var(--pg-muted); font-size: 12px; }
.pg-check { display: inline-flex; align-items: center; gap: 8px; color: var(--pg-muted); font-size: 13px; }
.pg-name { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 220px; }
.pg-name > span { color: var(--pg-muted); font-size: 13px; }
.pg-name .pg-input { flex: 1; }
.pg-menu { position: absolute; z-index: 2; display: grid; min-width: 180px; padding: 5px; border: 1px solid var(--pg-line); border-radius: 10px; background: var(--pg-panel); box-shadow: var(--pg-shadow); }
.pg-menu-item { padding: 8px 10px; border: 0; border-radius: 6px; background: none; color: var(--pg-text); font: 13px var(--pg-font); text-align: left; cursor: pointer; }
.pg-menu-item:hover { background: var(--pg-raised); }
.pg-confirm { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; background: rgb(0 0 0 / 0.35); }
.pg-confirm-card { width: min(380px, calc(100% - 32px)); padding: 18px; box-sizing: border-box; border: 1px solid var(--pg-line); border-radius: 12px; background: var(--pg-panel); box-shadow: var(--pg-shadow); }
.pg-confirm-card p { margin: 0 0 16px; overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .pg-row { grid-template-columns: 24px minmax(0, 1fr) 72px 32px; }
  .pg-explorer:not([data-mode="browse"]) .pg-row { grid-template-columns: 24px minmax(0, 1fr) 72px; }
  .pg-row-when { display: none; }
}

/* Save As, step 1: keep in browser storage or download */
.pg-choice { display: grid; align-content: start; gap: 10px; padding: 22px; }
.pg-title { margin: 0 0 6px; font: 600 18px var(--pg-font); letter-spacing: -0.015em; overflow-wrap: anywhere; }
.pg-option { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid var(--pg-line); border-radius: 12px; background: var(--pg-bg); color: var(--pg-text); font: inherit; text-align: left; cursor: pointer; }
.pg-option:hover:not(:disabled) { border-color: var(--pg-accent); }
.pg-option:disabled { opacity: 0.5; cursor: default; }
.pg-option .pg-icon { width: 26px; height: 26px; color: var(--pg-accent); }
.pg-option > span { display: grid; gap: 2px; }
.pg-option strong { font-weight: 600; }
.pg-option small { color: var(--pg-muted); font-size: 13px; }
.pg-choice .pg-actions { margin-top: 6px; }

/* Notices */
.pg-toasts { position: fixed; right: 16px; bottom: 16px; z-index: 2147483001; display: grid; gap: 8px; font: 14px/1.4 var(--pg-font); }
.pg-toast { display: flex; align-items: center; gap: 10px; max-width: min(460px, calc(100vw - 32px)); padding: 10px 10px 10px 14px; box-sizing: border-box; border: 1px solid var(--pg-line); border-radius: 10px; background: var(--pg-panel); color: var(--pg-text); box-shadow: var(--pg-shadow); }
.pg-toast > span { flex: 1; }

/* The Files page */
.pg-files-page { margin: 0; min-height: 100vh; background: var(--pg-bg); color: var(--pg-text); font: 14px/1.45 var(--pg-font); -webkit-font-smoothing: antialiased; }
.pg-page-head { max-width: 1120px; margin: 0 auto; padding: 32px 16px 16px; }
.pg-page-head a { color: var(--pg-muted); text-decoration: none; font: 500 12px var(--pg-mono); letter-spacing: 0.04em; }
.pg-page-head a:hover { color: var(--pg-text); }
.pg-page-head h1 { margin: 12px 0 0; font-size: clamp(32px, 5vw, 52px); font-weight: 600; letter-spacing: -0.04em; line-height: 1.05; }
.pg-files-main { max-width: 1120px; margin: 0 auto 32px; padding: 0 16px; }
.pg-files-main .pg-explorer { height: min(72vh, 760px); border: 1px solid var(--pg-line); border-radius: 14px; background: var(--pg-panel); }
```

- [ ] **Step 5: Write `shell/files-page.js` and `files/index.html`**

`shell/files-page.js`:

```js
// /files/: the explorer as a page. "Open in <app>" goes to the app with ?open=browser:/… (files.js opens it).
import { appHref, flatApps, loadApps } from './apps.js'
import { explorer } from './explorer.js'
import { toAppPath } from './paths.js'

export async function mountFilesPage(container) {
  const apps = flatApps(await loadApps())
  const view = explorer({
    mode: 'browse',
    apps,
    onOpenInApp: (path, app) => (location.href = `${appHref(app)}?open=${encodeURIComponent(toAppPath(path))}`),
  })
  container.append(view.el)
  await view.ready
  view.focus()
}
```

`files/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Files</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/shell/shell.css">
</head>
<body class="pg-files-page">
  <header class="pg-page-head">
    <a href="/">← playground.daijro.dev</a>
    <h1>Files</h1>
  </header>
  <main class="pg-files-main" id="files"></main>
  <script type="module">
    import { mountFilesPage } from '/shell/files-page.js'
    mountFilesPage(document.getElementById('files'))
  </script>
</body>
</html>
```

- [ ] **Step 6: Build the Files page and link it from the dashboard**

In `vite.config.js`, add to the `defineConfig({ … })` object, after `appType: 'mpa',`:

```js
  build: { rollupOptions: { input: { main: 'index.html', files: 'files/index.html' } } },
```

In `index.html` (the dashboard), replace the top bar's switch line:

```html
      <label class="switch"><input type="checkbox" role="switch" id="latest">Use latest commits</label>
```

with:

```html
      <div class="bar-end">
        <a class="files-link" href="/files/">Files</a>
        <label class="switch"><input type="checkbox" role="switch" id="latest">Use latest commits</label>
      </div>
```

Then add these rules to the dashboard's `<style>`, after the `.switch input:focus-visible` rule:

```css
    .bar-end { display: flex; align-items: center; gap: 18px; }
    .files-link { color: var(--muted); font-size: 13px; font-weight: 500; text-decoration: none; }
    .files-link:hover { color: var(--text); }
    .files-link:focus-visible { outline: 2px solid var(--text); outline-offset: 3px; border-radius: 2px; }
```

- [ ] **Step 7: Write the failing tests `tests/explorer.test.mjs`**

```js
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
  await page.getByRole('link', { name: 'Files' }).click()
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

  await row(page, 'todo.txt').dragTo(row(page, 'Reports'))
  await until(() => stat(page, '/Reports/todo.txt'), 5000, 'the move')
  assert.equal(await stat(page, '/todo.txt'), null)

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
```

- [ ] **Step 8: Run them**

Run: `node --test tests/explorer.test.mjs`
Expected: all 5 tests PASS. If one fails, fix the explorer (not the test) unless the test's selector is wrong.

- [ ] **Step 9: Look at it**

Run: `npm run dev` (if it isn't already running on 5173), then capture both color schemes with `files-shot.mjs` (below).

```bash
cat > /tmp/files-shot.mjs <<'EOF'
import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: '/usr/sbin/chromium' })
for (const colorScheme of ['dark', 'light']) {
  const p = await b.newPage({ colorScheme, viewport: { width: 1200, height: 800 } })
  await p.goto('http://localhost:5173/files/')
  await p.evaluate(async () => { const s = await import('/shell/store.js'); await s.write('/Reports/Budget Q3.xlsx', new Uint8Array(12000)); await s.write('/Memo.docx', new Uint8Array(40000)); await s.write('/Deck.pptx', new Uint8Array(900000)) })
  await p.reload(); await p.waitForTimeout(500)
  await p.screenshot({ path: `/tmp/files-${colorScheme}.png` })
}
await b.close()
EOF
node /tmp/files-shot.mjs
```

Open `/tmp/files-dark.png` and `/tmp/files-light.png` and check:
- the folder sorts first;
- files carry their app icons;
- the columns line up;
- the text is readable in both schemes.

- [ ] **Step 10: Commit**

```bash
git add shell/ui.js shell/apps.js shell/explorer.js shell/shell.css shell/files-page.js files/index.html vite.config.js index.html tests/explorer.test.mjs
git commit -m "Add the file explorer and the Files page" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `playgroundFiles`: the API the apps call, and the Open / Save As / Files dialogs

**Files:**
- Create: `shell/files.js`, `tests/files.test.mjs`

**Interfaces:**
- Consumes:
  - `store.js` (Task 2);
  - `paths.js` (Task 1);
  - `explorer`, `h`, `icon`, `modal`, `toast`, `download`, `loadApps`, `flatApps`, `currentApp`, `appHref` (Task 4).
- Produces `globalThis.playgroundFiles` (the contract the Rust bridges in Tasks 7–9 call):
  - `open({ types }) → Promise<[{ path: 'browser:/…' | null, name, bytes: Uint8Array }] | null>`
  - `saveAs({ name, types, bytes }) → Promise<{ path: 'browser:/…' } | { download: true } | null>`
    - Download means the shell already downloaded `bytes` under `name`.
  - `write(appPath, bytes) → undefined`
    - Throws for a path without `browser:`.
    - Failures show a toast with **Download instead**.
  - `read(appPath) → Promise<Uint8Array>`
  - `download(name, bytes)`
  - `onOpen(callback)`
    - Delivers `?open=` once, and "Open in app" from the Files popup on later calls.
    - Without a callback, the file is dropped on the app's canvas.
- Produces the exports:
  - `openFilesPopup()`
  - `openHere(storePath)`
  - `savedAt() → ms`, the last save or open (for the leave warning in Task 6)

- [ ] **Step 1: Write the failing tests `tests/files.test.mjs`**

```js
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
  await page.getByRole('option', { name: /^Memo\.docx/ }).waitFor()
  assert.equal(await page.getByRole('option', { name: /^Budget\.xlsx/ }).count(), 0)
  await page.getByLabel('All files').check()
  await page.getByRole('option', { name: /^Budget\.xlsx/ }).waitFor()
  await page.getByRole('option', { name: /^Memo\.docx/ }).click()
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
  page.evaluate(() => playgroundFiles.saveAs({ name: 'x.docx', types: ['docx'], bytes: new Uint8Array() }))
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/files.test.mjs`
Expected: FAIL. `import('/shell/files.js')` rejects, because the file doesn't exist yet.

- [ ] **Step 3: Write `shell/files.js`**

```js
// globalThis.playgroundFiles: the browser file storage API the apps' patches call (patches/<app>.yaml has
// the Rust side), plus the Open, Save As and Files dialogs built on the explorer. Loaded on app pages by
// app.js. App paths are 'browser:/Folder/name.ext' (paths.js).
//
//   open({ types })               → [{ path, name, bytes }] | null    the explorer's Open; "From computer…"
//                                                                    gives a file with path: null
//   saveAs({ name, types, bytes }) → { path } | { download: true } | null
//                                    Keep → explorer Save; Download → the shell downloads `bytes` itself
//   write(path, bytes)            queued store write; a failure shows "Download instead"
//   read(path)                    → Promise<Uint8Array>
//   download(name, bytes)
//   onOpen(callback)              files for this app: ?open=browser:/… at startup, and "Open in <app>" in
//                                 the Files popup; apps that never register get them as a dropped file
import * as store from './store.js'
import { appHref, currentApp, flatApps, loadApps } from './apps.js'
import { explorer } from './explorer.js'
import { baseName, fromAppPath, toAppPath } from './paths.js'
import { download, h, icon, modal, toast } from './ui.js'

let handler = null
let lastSaveOrOpen = Date.now()
/** When the app last saved or opened a file (the leave warning compares it with the last input). */
export const savedAt = () => lastSaveOrOpen
const mark = () => (lastSaveOrOpen = Date.now())

const fileAt = async (path) => ({ path: toAppPath(path), name: baseName(path), bytes: await store.read(path) })

/** Give a stored file to the app on this page: its onOpen callback, else a file dropped on its canvas. */
export async function openHere(path) {
  const file = await fileAt(path)
  mark()
  if (handler) return handler(file)
  const canvas = document.querySelector('canvas')
  if (!canvas) return
  const dataTransfer = new DataTransfer()
  dataTransfer.items.add(new File([file.bytes], file.name))
  const r = canvas.getBoundingClientRect()
  const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, dataTransfer }
  for (const type of ['dragenter', 'dragover', 'drop']) canvas.dispatchEvent(new DragEvent(type, at))
}

async function open({ types = [] } = {}) {
  const apps = flatApps(await loadApps())
  const picked = await modal((done) => explorer({ mode: 'open', types, apps, onDone: done }), { label: 'Open' })
  if (!picked) return null
  mark()
  if (picked.computer) return [{ path: null, name: picked.computer.name, bytes: new Uint8Array(await picked.computer.arrayBuffer()) }]
  return [await fileAt(picked)]
}

async function saveAs({ name = 'Untitled', types = [], bytes = new Uint8Array() } = {}) {
  const apps = flatApps(await loadApps())
  const available = await store.available()
  const answer = await modal(
    (done) => {
      let saving = null
      const keep = h(
        'button',
        {
          class: 'pg-option',
          type: 'button',
          disabled: !available,
          onclick: () => {
            saving = explorer({ mode: 'save', types, name, apps, onDone: done })
            view.replaceWith(saving.el)
            saving.ready.then(() => saving.focus())
          },
        },
        icon('browser'),
        h('span', {}, h('strong', {}, 'Keep in browser storage'), h('small', {}, available ? 'Saved to Files in this browser. Save and AutoSave keep it up to date.' : 'Browser storage isn’t available in this window.')),
      )
      const toDevice = h(
        'button',
        { class: 'pg-option', type: 'button', onclick: () => done({ download: true }) },
        icon('download'),
        h('span', {}, h('strong', {}, 'Download to device'), h('small', {}, 'A copy goes to your downloads. The next Save asks again.')),
      )
      const view = h(
        'div',
        { class: 'pg-choice' },
        h('h2', { class: 'pg-title' }, `Save “${name}”`),
        keep,
        toDevice,
        h('div', { class: 'pg-actions' }, h('button', { class: 'pg-btn', type: 'button', onclick: () => done(null) }, 'Cancel')),
      )
      return { el: view, focus: () => (available ? keep : toDevice).focus(), destroy: () => saving?.destroy() }
    },
    { label: 'Save As' },
  )
  if (!answer) return null
  if (answer.download) {
    download(name, bytes)
    return { download: true }
  }
  mark()
  store.persist()
  return { path: toAppPath(answer) }
}

function write(appPath, bytes) {
  const path = fromAppPath(appPath)
  if (!path) throw new Error(`${appPath} isn't a browser storage path`)
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  mark()
  store.write(path, data).catch((e) => {
    console.error(`playgroundFiles: couldn't save ${path}`, e)
    const full = e?.name === 'QuotaExceededError'
    toast(`Couldn’t save ${baseName(path)} to browser storage${full ? ': it’s full' : ''}.`, [{ label: 'Download instead', run: () => download(baseName(path), data) }])
  })
}

function read(appPath) {
  const path = fromAppPath(appPath)
  return path ? store.read(path) : Promise.reject(new Error(`${appPath} isn't a browser storage path`))
}

// ?open=browser:/… (from the Files page or another app): hand it to this app once it can take it.
const startupPath = fromAppPath(new URLSearchParams(location.search).get('open'))
let startupDone = !startupPath
function startup() {
  if (startupDone) return
  startupDone = true
  const url = new URL(location.href)
  url.searchParams.delete('open')
  history.replaceState(history.state, '', url)
  openHere(startupPath).catch(() => toast(`Couldn’t open ${baseName(startupPath)}: it isn’t in Files anymore.`))
}
// Apps that never call onOpen get it dropped on their canvas, a moment after their loading screen is gone.
if (startupPath) {
  const begun = Date.now()
  const wait = () => {
    if (startupDone) return
    const loaded = document.querySelector('canvas') && !document.querySelector('[id$="_loading"]')
    if (loaded || Date.now() - begun > 120_000) setTimeout(startup, 1500)
    else setTimeout(wait, 250)
  }
  wait()
}

function onOpen(callback) {
  handler = callback
  startup()
}

/** The Files button: the explorer as a popup. "Open in <app>" opens files of this app here, others there. */
export async function openFilesPopup() {
  const apps = flatApps(await loadApps())
  const here = currentApp()
  await modal(
    (done) =>
      explorer({
        mode: 'browse',
        apps,
        closable: true,
        onDone: done,
        onOpenInApp: (path, app) => {
          if (app.slug !== here?.slug) return (location.href = `${appHref(app)}?open=${encodeURIComponent(toAppPath(path))}`)
          done(null)
          openHere(path).catch((e) => toast(`Couldn’t open ${baseName(path)}: ${e.message}`))
        },
      }),
    { label: 'Files' },
  )
}

globalThis.playgroundFiles = Object.freeze({ open, saveAs, write, read, download, onOpen })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/files.test.mjs`
Expected: all 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add shell/files.js tests/files.test.mjs
git commit -m "Add playgroundFiles: Open, Save As, write and read against browser storage" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The top bar on every app page

**Files:**
- Create: `shell/topbar.js`, `shell/app.js`, `tests/topbar.test.mjs`
- Modify: `scripts/fetch.mjs` (inject the shell), `scripts/page-prelude.js` (leave shell UI alone)

**Interfaces:**
- Consumes:
  - `loadApps`, `currentApp`, `appHref` (Task 4);
  - `openFilesPopup`, `savedAt` (Task 5);
  - `pendingWrites` (Task 2);
  - `h`, `icon`, `isolate` (Task 4).
- Produces:
  - `mountTopbar() → Promise<void>`
  - `app.js`, the page entry, which:
    - loads `files.js` (so `playgroundFiles` exists before the app starts);
    - mounts the bar;
    - installs the leave warning.

- [ ] **Step 1: Write the failing tests `tests/topbar.test.mjs`**

These use the installed Word and Excel. Run `make fetch` first if `public/word/` is missing.

```js
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

test('the fullscreen button enters and leaves fullscreen', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  await page.getByRole('button', { name: 'Fullscreen' }).click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  await page.getByRole('button', { name: 'Exit fullscreen' }).click()
  await page.waitForFunction(() => !document.fullscreenElement)
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/topbar.test.mjs`
Expected: FAIL. `.pg-bar` never appears (the page has no shell yet).

- [ ] **Step 3: Write `shell/topbar.js`**

```js
// The bar above every app: back to the dashboard, switch apps, this build's version, Files and fullscreen.
import { appHref, currentApp, loadApps } from './apps.js'
import { openFilesPopup } from './files.js'
import { h, icon, isolate } from './ui.js'

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS = [['year', 31536e3], ['month', 2592e3], ['week', 6048e2], ['day', 864e2], ['hour', 3600], ['minute', 60]]
const ago = (iso) => {
  const s = (Date.parse(iso) - Date.now()) / 1000
  const [unit, size] = UNITS.find(([, n]) => Math.abs(s) >= n) ?? ['minute', 60]
  return relative.format(Math.round(s / size), unit)
}

export async function mountTopbar() {
  const here = currentApp()
  const { groups } = await loadApps()
  const app = groups.flatMap((g) => g.apps).find((a) => a.slug === here?.slug)
  const build = app?.[here.channel]

  const menu = h(
    'div',
    { class: 'pg-apps', id: 'pg-apps', popover: 'auto', role: 'menu', 'aria-label': 'Apps' },
    groups.map((g) => [
      h('p', { class: 'pg-apps-group' }, g.name),
      g.apps.map((a) =>
        h(
          'a',
          { class: 'pg-app', role: 'menuitem', href: appHref(a), 'aria-current': a.slug === here?.slug ? 'page' : null },
          h('img', { src: a.icon, alt: '' }),
          h('span', {}, h('strong', {}, a.name), h('small', {}, a.blurb)),
          a.slug === here?.slug ? icon('check') : null,
        ),
      ),
    ]),
  )

  const fullscreen = h('button', { class: 'pg-bar-btn', type: 'button', 'aria-label': 'Fullscreen', title: 'Fullscreen' }, icon('expand'))
  fullscreen.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}))
  addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement
    fullscreen.replaceChildren(icon(on ? 'shrink' : 'expand'))
    fullscreen.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen')
    fullscreen.title = on ? 'Exit fullscreen' : 'Fullscreen'
  })

  const bar = isolate(
    h(
      'header',
      { class: 'pg-bar' },
      h('a', { class: 'pg-home', href: '/' }, h('span', { class: 'pg-mark', 'aria-hidden': 'true' }), h('span', { class: 'pg-label' }, 'Playground')),
      app ? h('button', { class: 'pg-switch', type: 'button', popovertarget: 'pg-apps', 'aria-haspopup': 'menu' }, h('img', { src: app.icon, alt: '' }), app.name, icon('chevron')) : null,
      build
        ? h(
            'span',
            { class: `pg-version${here.channel === 'head' ? ' pg-head' : ''}`, title: here.channel === 'head' ? 'Latest commit (unstable)' : 'Release' },
            build.label + (here.channel === 'head' && build.date ? ` · ${ago(build.date)}` : ''),
          )
        : null,
      h('span', { class: 'pg-spacer' }),
      h('button', { class: 'pg-bar-btn', type: 'button', onclick: () => openFilesPopup() }, icon('files'), h('span', { class: 'pg-label' }, 'Files')),
      fullscreen,
      menu,
    ),
  )
  document.body.prepend(bar)
}
```

Note: the Files button's accessible name is "Files" (its icon is `aria-hidden`), which the test relies on.

- [ ] **Step 4: Write `shell/app.js`**

```js
// The shell on an app page (fetch.mjs adds it to each installed app's index.html, before the app's own
// scripts): the browser file storage API (files.js) the app's patches call, the top bar, and a warning
// before leaving with work the app may not have saved.
import { savedAt } from './files.js'
import { pendingWrites } from './store.js'
import { mountTopbar } from './topbar.js'

const start = () => mountTopbar().catch((e) => console.error('playground: top bar', e))
if (document.body) start()
else addEventListener('DOMContentLoaded', start, { once: true })

// The shell can't see an app's own "unsaved" state, so: typing or clicking in the app since its last save or
// open counts as unsaved work, as do store writes still in flight.
let lastInput = 0
const inShell = (target) => target instanceof Element && !!target.closest('.pg-bar, .pg-modal, .pg-toasts, .pg-apps')
for (const type of ['keydown', 'pointerdown']) addEventListener(type, (e) => inShell(e.target) || (lastInput = Date.now()), true)
addEventListener('beforeunload', (e) => {
  if (pendingWrites() > 0 || lastInput > savedAt()) e.preventDefault()
})
```

- [ ] **Step 5: Inject the shell into each app page in `scripts/fetch.mjs`**

In `patch(t, dir)`, replace the last two `.replace(…)` calls of the `html` chain:

```js
    .replace(/\s*<script id="playground-prelude">[\s\S]*?<\/script>/, '')
    .replace(/<meta charset[^>]*>/i, (m) => `${m}\n  <script id="playground-prelude">{\n${script}}</script>`)
```

with:

```js
    .replace(/\s*<script id="playground-prelude">[\s\S]*?<\/script>/, '')
    .replace(/\s*<link rel="stylesheet" href="\/shell\/shell\.css">/g, '')
    .replace(/\s*<script type="module" src="\/shell\/app\.js"><\/script>/g, '')
    // The prelude, then the shell (top bar, browser file storage: shell/), first in <head>, so
    // playgroundFiles exists before the app's own scripts start it.
    .replace(
      /<meta charset[^>]*>/i,
      (m) => `${m}\n  <script id="playground-prelude">{\n${script}}</script>\n  <link rel="stylesheet" href="/shell/shell.css">\n  <script type="module" src="/shell/app.js"></script>`,
    )
```

- [ ] **Step 6: Keep the prelude's shortcut and paste handling out of shell UI**

In `scripts/page-prelude.js`, add one line at the top of each of the two listeners.

The keydown listener's body begins:

```js
  (e) => {
    if (e.target instanceof Element && e.target.closest('.pg-bar, .pg-modal, .pg-toasts')) return
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
```

The paste listener's body begins:

```js
  (e) => {
    if (e.target instanceof Element && e.target.closest('.pg-bar, .pg-modal, .pg-toasts')) return
    const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
```

- [ ] **Step 7: Re-patch the installed apps and run the tests**

Run: `make fetch && node --test tests/topbar.test.mjs`
Expected:
- `make fetch` prints `already installed` for each app and channel; it re-patches the pages without downloading.
- All 7 tests PASS.

- [ ] **Step 8: Check the bar on all 12 apps, on both channels**

```bash
cat > /tmp/bars.mjs <<'EOF'
import { chromium } from 'playwright-core'
const GPU = ['--use-angle=vulkan', '--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-vulkan=native', '--disable-vulkan-surface']
const b = await chromium.launch({ executablePath: '/usr/sbin/chromium', args: GPU })
const apps = (await (await fetch('http://localhost:5173/shell/apps.json')).json()).groups.flatMap((g) => g.apps)
for (const app of apps) for (const ch of ['release', 'head']) {
  if (!app[ch]) continue
  const p = await b.newPage({ colorScheme: 'dark', viewport: { width: 1400, height: 860 } })
  await p.goto(`http://localhost:5173${app[ch].path}`)
  await p.waitForTimeout(12000)
  const canvas = await p.locator('body > canvas').first().boundingBox()
  console.log(app.slug.padEnd(14), ch.padEnd(8), 'canvas y', canvas?.y, 'h', canvas?.height, 'bar', await p.locator('.pg-bar').count())
  await p.screenshot({ path: `/tmp/bar-${app.slug}-${ch}.png` })
  await p.close()
}
await b.close()
EOF
node /tmp/bars.mjs
```

Expected: every line shows `canvas y 36 h 824 bar 1`.

Then open several of the screenshots (`/tmp/bar-word-release.png`, `/tmp/bar-after-effects-release.png`, `/tmp/bar-acrobat-release.png`, `/tmp/bar-pro-tools-head.png`) and check:
- each app draws its whole UI below the bar;
- the app's theme still follows the browser.

- [ ] **Step 9: Commit**

```bash
git add shell/topbar.js shell/app.js scripts/fetch.mjs scripts/page-prelude.js tests/topbar.test.mjs
git commit -m "Add the top bar to every app: app switcher, version, Files and fullscreen" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Word saves, opens and autosaves in browser storage

**Files:**
- Modify: `patches/word.yaml`, by appending rules 1–7 after the existing theme rule
- Create: `tests/office.e2e.test.mjs`

**Interfaces:**
- Consumes the `playgroundFiles` contract (Task 5), and these upstream WordCraft items, verified identical at release `v0.1.0` (05d0b41) and main (7584b9b):
  - `crates/ui-egui/src/lib.rs`:
    - `pub struct Services { … pub inbox: Option<Inbox>, … }`
    - `WordApp::run`'s web branch, `if self.services.download.is_some() && matches!(id, "file.save" | …`
    - `pub fn now_ms() -> f64`, whose wasm arm returns `0.0`
    - `pub fn with_control(mut self, rx)`
    - `pub services: Services`
  - `crates/engine/src/io.rs`: `#[cfg(target_arch = "wasm32")] pub fn save_path(path: &std::path::Path, _doc: &Document) -> Result<(), String>`, an error stub.
  - `crates/ui-egui/src/backstage.rs`: the Recent click, `let _ = app.run("file.open", json!({"path": p}));`
  - `apps/wordcraft-web/src/web.rs`:
    - `app.autosave = false;`
    - `Ok(Box::new(WebShell { app, inbox }))`
    - the consts `DOC_EXTS` and `IMAGE_EXTS`
  - The control channel: `ControlRequest::new("engine.execute", {command, params})` reaches `app.run(command, params)`.
- Produces: `wordcraft_engine::io::WEB_WRITE` and `wordcraft_ui_egui::WEB_NOW_MS`, both `OnceLock<fn…>`, set by the bridge.

- [ ] **Step 1: Install the local build tools (once per machine)**

`node scripts/build.mjs build` needs trunk and wasm-opt, which the machine lacks. `check` only needs cargo. Install both the way CI does:

```bash
mkdir -p ~/.local/tools/bin
curl -sSfL https://github.com/trunk-rs/trunk/releases/latest/download/trunk-x86_64-unknown-linux-gnu.tar.gz | tar -xz -C ~/.local/tools/bin
url=$(gh api repos/WebAssembly/binaryen/releases/latest -q '.assets[] | select(.name | endswith("x86_64-linux.tar.gz")) | .browser_download_url')
curl -sSfL "$url" | tar -xz -C ~/.local/tools
~/.local/tools/bin/trunk --version && ls ~/.local/tools/binaryen-*/bin/wasm-opt
```

Expected: a trunk version line, and the wasm-opt path.

Every later build command in this plan runs with this environment:

```bash
export RUSTUP_TOOLCHAIN=1.99.0 PATH=~/.local/tools/bin:$PATH WASM_OPT=$(ls ~/.local/tools/binaryen-*/bin/wasm-opt) GITHUB_TOKEN=$(gh auth token)
```

- [ ] **Step 2: Write the failing end-to-end test `tests/office.e2e.test.mjs`**

```js
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

test('Word: Save As, Save, AutoSave, Open and Download', { skip: !E2E }, () =>
  roundTrip('word', {
    savedAs: 'E2E Word.docx',
    autosave: true,
    edit: async (page) => {
      await page.mouse.click(700, 450)
      await page.keyboard.type(' hello')
    },
  }))
```

- [ ] **Step 3: Run it against today's build to verify it fails**

Run: `E2E=1 node --test tests/office.e2e.test.mjs`
Expected: FAIL at `getByRole('button', { name: /Keep in browser storage/ })` (timeout). Unpatched Word downloads on Ctrl+S.

- [ ] **Step 4: Append the browser-storage rules to `patches/word.yaml`**

Append after the existing theme rule:

````yaml

# ══ Browser storage ══════════════════════════════════════════════════════════════════════════════════════
# Rules 1–7 connect WordCraft's browser build to openplayground's file storage. The site's shell
# (shell/files.js in github.com/daijro/openplayground) gives every app page `globalThis.playgroundFiles`:
#   open({types}) → [{path, name, bytes}] | null          saveAs({name, types, bytes}) → {path} | {download:true} | null
#   write(path, bytes)    read(path) → Promise<bytes>      onOpen(callback)
# Its files have paths like `browser:/Reports/memo.docx`. What the user gets in Word:
#   - Save As, and Save on a document that isn't in browser storage yet, ask "Keep in browser storage /
#     Download to device", then where; the document then lives at that path (title, "Saved" state).
#   - Save on a browser-storage document writes back to it silently; AutoSave (on by default, as on the
#     desktop) does the same a moment after each edit.
#   - Open and Insert Picture open the site's file explorer (with "From computer…").
#   - Recent documents in browser storage reopen; the shell's ?open=browser:/… opens one at startup.
# If WordCraft gains its own browser-storage saving, compare it with this list and delete the rules whose
# job it now does (rule 7's bridge last, once nothing calls it) rather than forcing them to match.

# Rule 1/7: the two hooks the bridge (rule 7) fills in, on the host Services struct.
# What it's for: Save As in the browser has to ask asynchronously (the dialog is a web page), and Recent has
#   to open browser-storage files asynchronously; Services only had synchronous pickers.
# How: save_as_async(suggested name, docx bytes) shows the dialog; a "Keep" answer comes back as
#   `file.save {path}` on the control channel (rule 6). open_path_async(path) reads the file into `inbox`.
# Verify: rules 2 and 5 compile and use them.
# If upstream changes: put them on whatever struct carries the web services (open_async, download, inbox).
- file: crates/ui-egui/src/lib.rs
  find: 'pub inbox: Option<Inbox>,'
  replace: |-
    $&
        /// playground (patches/word.yaml): ask where to save: the suggested name and the docx bytes (for a
        /// download). A "Keep" answer comes back as `file.save {path: "browser:/…"}` on the control channel.
        pub save_as_async: Option<Box<dyn Fn(&str, Vec<u8>)>>,
        /// playground: reopen a browser-storage document by its `browser:` path; it arrives through `inbox`.
        pub open_path_async: Option<Box<dyn Fn(&str)>>,

# Rule 2/7: Save and Save As in the browser build.
# What it's for: Save on a `browser:` document writes it back silently; anything else (Save on a new or
#   uploaded document, Save As) asks Keep / Download instead of downloading straight away.
# How: runs in WordApp::run before its web branch ("Web: saving and exporting become downloads"). A
#   `browser:` path goes to the engine's own `file.save {path}`, which serializes, writes through
#   io::save_path → WEB_WRITE (rule 3), and sets the document's path and saved state. Otherwise
#   save_as_async (rule 1) gets the name and docx bytes. Save As from the UI (save_as_dialog: pick_save
#   returns the bare name on the web, then `file.save {path: name}`) lands here too. Exports
#   (file.exportPdf/exportPng) are left to the download branch on purpose.
# Verify: new document → type → Ctrl+S → the Keep/Download dialog; Keep → name → Save; type, Ctrl+S → no
#   dialog, and the file's time in Files changes.
# If upstream changes: anchor on whatever handles file.save / file.saveAs in the web build before it
#   downloads.
- file: crates/ui-egui/src/lib.rs
  find: 'if self\.services\.download\.is_some\(\) && matches!\(id, "file\.save"'
  before: |
    // playground (patches/word.yaml): Save / Save As against browser storage, before the download branch.
            if let Some(ask) = &self.services.save_as_async
                && matches!(id, "file.save" | "file.saveAs")
            {
                let path = params.get("path").and_then(Value::as_str).map(str::to_string).or_else(|| {
                    if id == "file.save" { self.session.path.as_ref().map(|p| p.to_string_lossy().to_string()) } else { None }
                });
                if let Some(path) = path.filter(|p| p.starts_with("browser:")) {
                    let r = self.session.run("file.save", &json!({"path": path})).map_err(|e| e.to_string());
                    self.after_command("file.save");
                    if let Err(e) = &r {
                        self.status(e.clone());
                    }
                    return r;
                }
                let name = format!("{}.docx", self.title_stem());
                let bytes = wordcraft_engine::io::save_bytes(&name, &self.session.doc)?;
                ask(&name, bytes);
                return Ok(json!({"asked": true}));
            }
            

# Rule 3/7: where the engine writes `browser:` paths in the browser build.
# What it's for: the engine's save (Save, AutoSave) ends in io::save_path, which in the browser build was an
#   error stub. Now a `browser:` path's bytes go to playgroundFiles.write; other paths still error.
# How: WEB_WRITE is a fn pointer the bridge (rule 7) sets; the engine crate needs no new dependency.
# Verify: rule 2's silent Save and AutoSave change the stored file.
# If upstream changes: put the hook wherever the wasm build's "write document bytes to a path" lives.
- file: crates/engine/src/io.rs
  find: '(#\[cfg\(target_arch = "wasm32"\)\]\s*pub fn save_path\(path: &std::path::Path, (\w+): &Document\) -> Result<\(\), String> \{)'
  replace: |-
    /// playground (patches/word.yaml): where `browser:` paths are written in the browser build. The web
    /// crate's bridge sets it to openplayground's `playgroundFiles.write`; unset, saving errors as upstream.
    pub static WEB_WRITE: std::sync::OnceLock<fn(&str, &[u8]) -> Result<(), String>> = std::sync::OnceLock::new();

    $1
        if let Some(write) = WEB_WRITE.get()
            && path.to_string_lossy().starts_with("browser:")
        {
            let path = path.to_string_lossy();
            return write(&path, &save_bytes(&path, $2)?);
        }

# Rule 4/7: a working clock in the browser build.
# What it's for: AutoSave waits for a pause after the last edit, timed with now_ms(), which returns 0.0 in
#   the browser build, so AutoSave could never fire there. (Status messages time out with it too.)
# How: the wasm arm returns Date.now() through WEB_NOW_MS, a fn pointer the bridge (rule 7) sets.
# Verify: with a browser-storage document, type and wait ~3 s: the stored file updates by itself.
# If upstream changes: if now_ms gets a real wasm clock (js_sys, web-time, egui's input time), delete this.
- file: crates/ui-egui/src/lib.rs
  find: '(pub fn now_ms\(\) -> f64 \{[\s\S]*?#\[cfg\(target_arch = "wasm32"\)\]\s*\{\s*)0\.0'
  replace: |-
    /// playground (patches/word.yaml): the browser clock (`Date.now`), set by the web crate's bridge.
    pub static WEB_NOW_MS: std::sync::OnceLock<fn() -> f64> = std::sync::OnceLock::new();

    $1WEB_NOW_MS.get().map_or(0.0, |now| now())

# Rule 5/7: Recent documents in browser storage reopen.
# What it's for: File → Recent lists `browser:` paths after saving there; clicking one ran `file.open
#   {path}`, which the browser build can't read synchronously.
# How: a `browser:` entry goes to open_path_async (rule 1), which reads it into the inbox; the inbox opens it
#   with its path, so it stays bound to that file.
# Verify: save a document to browser storage, reload, File → Open: it's under Recent; clicking it opens it.
# If upstream changes: anchor on the Recent list's click handler.
- file: crates/ui-egui/src/backstage.rs
  find: 'let _ = app\.run\("file\.open", json!\(\{"path": p\}\)\);'
  replace: |-
    // playground (patches/word.yaml): a browser-storage document reopens through the browser.
                if let (true, Some(open)) = (p.starts_with("browser:"), &app.services.open_path_async) {
                    open(&p);
                } else {
                    let _ = app.run("file.open", json!({"path": p}));
                }

# Rule 6/7: switch it on at startup.
# What it's for: AutoSave back on (the desktop default; the browser build turned it off because it had
#   nowhere to write), the control channel Save As answers come back on, and the bridge (rule 7) installed.
# How: just before the app is handed to eframe (the theme rule above inserts its block at the same anchor).
#   with_control wires the app's existing, otherwise desktop-only, control receiver.
# Verify: rules 2–5 work; without the shell (playgroundFiles missing) install() returns early and the app
#   behaves as upstream (rfd picker, downloads).
# If upstream changes: anchor on where web.rs hands the app to eframe.
- file: apps/*-web/src/**/*.rs
  find: 'Ok\(Box::new\(\w*Shell\b'
  before: |
    // playground (patches/word.yaml): browser storage.
                        let mut app = app;
                        app.autosave = true;
                        let (playground_tx, playground_rx) = std::sync::mpsc::channel();
                        let mut app = app.with_control(playground_rx);
                        playground::install(&mut app.services, playground_tx, cc.egui_ctx.clone());
                        

# Rule 7/7: the bridge between the app's web services and `playgroundFiles`.
# What it's for: everything above; this is the only code that talks to the page.
# How: install() replaces open_async (rfd) with the explorer, fills save_as_async / open_path_async (rule 1),
#   WEB_WRITE (rule 3) and WEB_NOW_MS (rule 4), and registers onOpen (?open= and Files' "Open in Word").
#   Save As answers go out as `file.save {path}` through the control channel (rule 6) and run in WordApp::run
#   (rule 2). Without playgroundFiles it changes nothing.
# Verify: the browser-storage flows above.
# If upstream changes: this is self-contained; keep it at the end of the web crate's main file and adjust
#   the names it uses (Services fields, ControlRequest, Inbox, DOC_EXTS/IMAGE_EXTS).
- file: apps/*-web/src/web.rs
  find: '$(?![\s\S])'
  before: |

    /// playground (patches/word.yaml): the bridge between WordCraft's web services and openplayground's
    /// browser file storage, `globalThis.playgroundFiles` (shell/files.js in github.com/daijro/openplayground).
    mod playground {
        use std::sync::mpsc::Sender;

        use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};
        use wordcraft_ui_egui::{ControlRequest, Inbox, Services};

        /// Route the app's file services through browser storage. Without the shell (a page not served by
        /// openplayground) nothing changes: the rfd picker and downloads stay.
        pub fn install(services: &mut Services, control: Sender<ControlRequest>, ctx: egui::Context) {
            if api().is_none() {
                log::warn!("playground: no playgroundFiles on this page; keeping downloads");
                return;
            }
            let Some(inbox) = services.inbox.clone() else { return };
            let _ = wordcraft_engine::io::WEB_WRITE.set(write);
            let _ = wordcraft_ui_egui::WEB_NOW_MS.set(js_sys::Date::now);
            let (i, c) = (inbox.clone(), ctx.clone());
            services.open_async = Some(Box::new(move |purpose: &str| {
                open(if purpose == "picture" { super::IMAGE_EXTS } else { super::DOC_EXTS }, i.clone(), c.clone());
            }));
            let (i, c) = (inbox.clone(), ctx.clone());
            services.open_path_async = Some(Box::new(move |path: &str| read(path.to_string(), i.clone(), c.clone())));
            let c = ctx.clone();
            services.save_as_async = Some(Box::new(move |name: &str, bytes: Vec<u8>| {
                save_as(name, &["docx", "odt", "rtf"], &bytes, control.clone(), c.clone(), "file.save");
            }));
            on_open(inbox, ctx);
        }

        fn api() -> Option<JsValue> {
            js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("playgroundFiles")).ok().filter(JsValue::is_object)
        }

        /// `playgroundFiles[method](...args)`; None when the shell is missing or the call threw.
        fn call(method: &str, args: &[JsValue]) -> Option<JsValue> {
            let api = api()?;
            let f = js_sys::Reflect::get(&api, &JsValue::from_str(method)).ok()?.dyn_into::<js_sys::Function>().ok()?;
            f.apply(&api, &args.iter().collect::<js_sys::Array>()).ok()
        }

        fn object(fields: &[(&str, JsValue)]) -> JsValue {
            let o = js_sys::Object::new();
            for (k, v) in fields {
                let _ = js_sys::Reflect::set(&o, &JsValue::from_str(k), v);
            }
            o.into()
        }

        fn list(items: &[&str]) -> JsValue {
            items.iter().map(|s| JsValue::from_str(s)).collect::<js_sys::Array>().into()
        }

        fn field(v: &JsValue, key: &str) -> JsValue {
            js_sys::Reflect::get(v, &JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED)
        }

        /// Await a promise from `call`: None when missing, rejected, or answered null/undefined (cancelled).
        async fn settle(promise: Option<JsValue>) -> Option<JsValue> {
            let promise = promise?.dyn_into::<js_sys::Promise>().ok()?;
            match wasm_bindgen_futures::JsFuture::from(promise).await {
                Ok(v) if !v.is_null() && !v.is_undefined() => Some(v),
                Ok(_) => None,
                Err(e) => {
                    log::error!("playground: {e:?}");
                    None
                }
            }
        }

        /// WEB_WRITE: hand a `browser:` path's bytes to the store, which saves them in the background.
        fn write(path: &str, bytes: &[u8]) -> Result<(), String> {
            call("write", &[JsValue::from_str(path), js_sys::Uint8Array::from(bytes).into()])
                .map(|_| ())
                .ok_or_else(|| format!("{path}: browser storage isn't available"))
        }

        /// A file from the shell ({path, name, bytes}) into the inbox: under its `browser:` path when it has
        /// one, so the app keeps that as the document's path, else under its name.
        fn deliver(file: &JsValue, inbox: &Inbox) {
            let name = field(file, "path").as_string().or_else(|| field(file, "name").as_string()).unwrap_or_else(|| "Document".into());
            let bytes = js_sys::Uint8Array::new(&field(file, "bytes")).to_vec();
            inbox.lock().unwrap_or_else(|e| e.into_inner()).push((name, bytes));
        }

        fn open(types: &[&str], inbox: Inbox, ctx: egui::Context) {
            let promise = call("open", &[object(&[("types", list(types))])]);
            wasm_bindgen_futures::spawn_local(async move {
                let Some(files) = settle(promise).await else { return };
                for file in js_sys::Array::from(&files).iter() {
                    deliver(&file, &inbox);
                }
                ctx.request_repaint();
            });
        }

        fn read(path: String, inbox: Inbox, ctx: egui::Context) {
            let promise = call("read", &[JsValue::from_str(&path)]);
            wasm_bindgen_futures::spawn_local(async move {
                let Some(bytes) = settle(promise).await else { return };
                inbox.lock().unwrap_or_else(|e| e.into_inner()).push((path, js_sys::Uint8Array::new(&bytes).to_vec()));
                ctx.request_repaint();
            });
        }

        /// Ask Keep / Download. Keep → the app saves to the chosen `browser:` path itself (`command {path}` on
        /// the control channel); Download → the shell has already downloaded `bytes`.
        fn save_as(name: &str, types: &[&str], bytes: &[u8], control: Sender<ControlRequest>, ctx: egui::Context, command: &'static str) {
            let options = object(&[("name", JsValue::from_str(name)), ("types", list(types)), ("bytes", js_sys::Uint8Array::from(bytes).into())]);
            let promise = call("saveAs", &[options]);
            wasm_bindgen_futures::spawn_local(async move {
                let Some(answer) = settle(promise).await else { return };
                let Some(path) = field(&answer, "path").as_string() else { return };
                let (request, _reply) = ControlRequest::new("engine.execute", serde_json::json!({"command": command, "params": {"path": path}}));
                let _ = control.send(request);
                ctx.request_repaint();
            });
        }

        /// Files the shell hands this app: ?open=browser:/… at startup, and "Open in Word" from Files.
        fn on_open(inbox: Inbox, ctx: egui::Context) {
            let callback = Closure::<dyn FnMut(JsValue)>::new(move |file: JsValue| {
                deliver(&file, &inbox);
                ctx.request_repaint();
            });
            call("onOpen", &[callback.as_ref().clone()]);
            callback.forget();
        }
    }
````

The `find: '$(?![\s\S])'` matches only the very end of the file. In multiline mode `$` matches at every line end, and the lookahead rules out all but the last.

- [ ] **Step 5: Check the rules apply and compile on both channels**

Run: `node scripts/build.mjs check word release && node scripts/build.mjs check word head` (with the Step 1 environment).
Expected:
- One `patched …` line per rule, 8 per channel (theme plus 7).
- Then `word (release): the patches apply and the app compiles`, and the same for `(head)`.

If cargo reports an error, fix the rule's Rust and rerun. Keep the logic: the comments describe it.

- [ ] **Step 6: Build Word, install it, and run the end-to-end test**

Run: `node scripts/build.mjs build word release && make fetch && E2E=1 node --test tests/office.e2e.test.mjs`
Expected:
- The build ends with `out/word-v0.1.0-<hash>.zip`.
- `make fetch` installs it ("word: downloading word-v0.1.0-…zip").
- The Word test PASSES.

If an `edit` click lands outside Word's page (nothing typed), adjust `edit` to click inside the page. Take a screenshot first: `page.screenshot({ path: '/tmp/word.png' })`.

- [ ] **Step 7: Check what the test can't**

With `npm run dev` running, open `http://localhost:5173/word/` in a browser and check:
1. Insert → Pictures opens the explorer (the Open dialog lists images) and inserts a stored picture.
2. After saving a document to browser storage and reloading, File → Open's Recent list shows it, and clicking it reopens it. The next Ctrl+S is silent.
3. The Files popup → right-click a `.docx` → "Open in Word" opens it in this tab.
4. The theme still follows the browser's light/dark setting.

- [ ] **Step 8: Commit**

```bash
git add patches/word.yaml tests/office.e2e.test.mjs
git commit -m "Word: Save, Save As, Open and AutoSave in browser storage" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Excel saves, opens and autosaves in browser storage

**Files:**
- Modify: `patches/excel.yaml`, by appending rules 1–7 after the existing theme rule
- Modify: `tests/office.e2e.test.mjs`, by adding the Excel test

**Interfaces:**
- Consumes the `playgroundFiles` contract (Task 5), and these upstream GridCraft items, verified identical at release `v0.1.0` (a60bd2f) and main (fb82389):
  - `crates/ui-egui/src/lib.rs`:
    - `pub struct Services { … pub open_async: Option<Box<dyn Fn()>>, pub inbox: Option<Inbox>, }`
    - `pub services: Services`
    - `pub control_rx: Option<Receiver<ControlRequest>>`
    - `open_dialog`'s `"saveAs"` arm, whose web branch is `} else if let Some(dl) = &self.services.download && let Ok(r) = self.session.run("file.saveBytes", …)`
    - the inbox drain, `self.session.run("file.open", json!({"name": name, "base64": b64}))`
    - `pub fn now_ms() -> f64`, whose wasm arm returns `0.0`
  - `crates/engine/src/io.rs`: `#[cfg(target_arch = "wasm32")] pub fn write_file(path: &str, _bytes: &[u8]) -> Result<()>`, an error stub; `Result` is the crate's one-parameter alias.
  - `crates/engine/src/cmd/file.rs`:
    - `open` keeps `str_param(p, "path")` as the document's path, even when the bytes come as base64;
    - `save` sets `d.path` for xlsx and json;
    - `save_as {path}` saves.
  - `control.rs`: `"engine.execute"` reaches `app.run(command, params)`.
- Produces: `gridcraft_engine::io::WEB_WRITE` and `gridcraft_ui_egui::WEB_NOW_MS`.

- [ ] **Step 1: Add the Excel test to `tests/office.e2e.test.mjs`**

Append:

```js
test('Excel: Save As, Save, Open and Download', { skip: !E2E }, () =>
  roundTrip('excel', {
    savedAs: 'E2E Book.xlsx',
    autosave: false, // Excel's AutoSave is off by default; Step 6 checks it by hand
    edit: async (page) => {
      await page.mouse.click(320, 320)
      await page.keyboard.type(String(Math.floor(Math.random() * 1000)))
      await page.keyboard.press('Enter')
    },
  }))
```

- [ ] **Step 2: Run it to verify it fails**

Run: `E2E=1 node --test --test-name-pattern Excel tests/office.e2e.test.mjs`
Expected: FAIL waiting for "Keep in browser storage". Unpatched Excel downloads.

- [ ] **Step 3: Append the browser-storage rules to `patches/excel.yaml`**

````yaml

# ══ Browser storage ══════════════════════════════════════════════════════════════════════════════════════
# Rules 1–7 connect GridCraft's browser build to openplayground's file storage. The site's shell
# (shell/files.js in github.com/daijro/openplayground) gives every app page `globalThis.playgroundFiles`:
#   open({types}) → [{path, name, bytes}] | null          saveAs({name, types, bytes}) → {path} | {download:true} | null
#   write(path, bytes)    read(path) → Promise<bytes>      onOpen(callback)
# Its files have paths like `browser:/Reports/budget.xlsx`. What the user gets in Excel:
#   - Save on a workbook without a file, and Save As, ask "Keep in browser storage / Download to device", then
#     where; the workbook then lives at that path (window title, unsaved state).
#   - Save on a browser-storage workbook writes back to it silently; the AutoSave switch in the title bar
#     (off by default, as upstream) does the same after each change.
#   - Open uses the site's file explorer (with "From computer…"); each workbook keeps its own path.
#   - The shell's ?open=browser:/… and Files' "Open in Excel" open a stored workbook.
# If GridCraft gains its own browser-storage saving, compare it with this list and delete the rules whose
# job it now does (rule 7's bridge last, once nothing calls it) rather than forcing them to match.

# Rule 1/7: the Save As hook the bridge (rule 7) fills in, on the host Services struct.
# What it's for: Save As in the browser has to ask asynchronously (the dialog is a web page); Services only
#   had a synchronous pick_save (None on the web).
# How: save_as_async(suggested name, xlsx bytes) shows the dialog; a "Keep" answer comes back as
#   `file.saveAs {path}` on the control channel (rule 6).
# Verify: rule 2 compiles and uses it.
# If upstream changes: put it on whatever struct carries the web services (open_async, download, inbox).
- file: crates/ui-egui/src/lib.rs
  find: 'pub inbox: Option<Inbox>,'
  replace: |-
    $&
        /// playground (patches/excel.yaml): ask where to save: the suggested name and the xlsx bytes (for a
        /// download). A "Keep" answer comes back as `file.saveAs {path: "browser:/…"}` on the control channel.
        pub save_as_async: Option<Box<dyn Fn(&str, Vec<u8>)>>,

# Rule 2/7: Save As in the browser build.
# What it's for: the engine asks for a path (Save without one, Save As) with a "saveAs" dialog request;
#   on the web open_dialog downloaded the workbook straight away. Now it asks Keep / Download.
# How: a new arm in open_dialog("saveAs"), between the desktop picker and the download branch, gets the
#   bytes the download branch would have (file.saveBytes) and hands them to save_as_async (rule 1). Keep →
#   `file.saveAs {path}` runs the engine's save, which writes through io::write_file → WEB_WRITE (rule 4) and
#   sets the workbook's path. Save on a workbook that has a `browser:` path never comes here: the engine
#   writes it directly.
# Verify: new workbook → type in a cell → Ctrl+S → the Keep/Download dialog; Keep → name → Save; edit,
#   Ctrl+S → no dialog, and the file's time in Files changes.
# If upstream changes: anchor on the web build's handling of the "saveAs" dialog request.
- file: crates/ui-egui/src/lib.rs
  find: '\} else if let Some\(dl\) = &self\.services\.download'
  replace: |-
    } else if let Some(ask) = &self.services.save_as_async
                    && let Ok(r) = self.session.run("file.saveBytes", json!({"format": "xlsx"}))
                    && let Some(b) = r.get("base64").and_then(Json::as_str).and_then(gridcraft_engine::io::base64_decode)
                {
                    // playground (patches/excel.yaml): Keep in browser storage, or download.
                    let name = r.get("name").and_then(Json::as_str).unwrap_or("Book.xlsx").to_string();
                    ask(&name, b);
                $&

# Rule 3/7: an opened browser-storage workbook keeps its path.
# What it's for: so Save (and AutoSave) write back to the file it was opened from.
# How: files arrive in the inbox as (name, bytes); the bridge (rule 7) names browser-storage files by their
#   `browser:` path. Passing that as `path` too makes the engine's file.open keep it (it already keeps a
#   `path` given with base64 bytes); other files open without a path, as before.
# Verify: Open a stored workbook from the explorer, edit, Ctrl+S: no dialog, and the stored file changes.
# If upstream changes: anchor on where inbox files are opened.
- file: crates/ui-egui/src/lib.rs
  find: 'self\.session\.run\("file\.open", json!\(\{"name": name, "base64": b64\}\)\)'
  replace: |-
    self.session.run("file.open", json!({"name": name, "base64": b64, "path": name.starts_with("browser:").then_some(name.as_str())}))

# Rule 4/7: where the engine writes `browser:` paths in the browser build.
# What it's for: the engine's save (Save, Save As with a path, AutoSave) ends in io::write_file, which in the
#   browser build was an error stub. Now a `browser:` path's bytes go to playgroundFiles.write.
# How: WEB_WRITE is a fn pointer the bridge (rule 7) sets; the engine crate needs no new dependency.
# Verify: rule 2's flow stores the workbook; a silent Save changes it.
# If upstream changes: put the hook wherever the wasm build's "write bytes to a path" lives.
- file: crates/engine/src/io.rs
  find: '(#\[cfg\(target_arch = "wasm32"\)\]\s*pub fn write_file\((\w+): &str, (\w+): &\[u8\]\) -> Result<\(\)> \{)'
  replace: |-
    /// playground (patches/excel.yaml): where `browser:` paths are written in the browser build. The web
    /// crate's bridge sets it to openplayground's `playgroundFiles.write`; unset, writing errors as upstream.
    pub static WEB_WRITE: std::sync::OnceLock<fn(&str, &[u8]) -> std::result::Result<(), String>> = std::sync::OnceLock::new();

    $1
        if let Some(write) = WEB_WRITE.get()
            && $2.starts_with("browser:")
        {
            return write($2, $3).map_err(EngineError::Other);
        }

# Rule 5/7: a working clock in the browser build.
# What it's for: AutoSave waits 2 s between saves, timed with now_ms(), which returns 0.0 in the browser
#   build, so AutoSave could never fire there.
# How: the wasm arm returns Date.now() through WEB_NOW_MS, a fn pointer the bridge (rule 7) sets.
# Verify: turn AutoSave on for a browser-storage workbook, edit a cell, wait ~3 s: the stored file updates.
# If upstream changes: if now_ms gets a real wasm clock, delete this.
- file: crates/ui-egui/src/lib.rs
  find: '(pub fn now_ms\(\) -> f64 \{[\s\S]*?#\[cfg\(target_arch = "wasm32"\)\]\s*\{\s*)0\.0'
  replace: |-
    /// playground (patches/excel.yaml): the browser clock (`Date.now`), set by the web crate's bridge.
    pub static WEB_NOW_MS: std::sync::OnceLock<fn() -> f64> = std::sync::OnceLock::new();

    $1WEB_NOW_MS.get().map_or(0.0, |now| now())

# Rule 6/7: switch it on at startup.
# What it's for: the control channel Save As answers come back on, and the bridge (rule 7) installed.
# How: just before the app is handed to eframe (the theme rule above inserts its block at the same anchor);
#   control_rx is the app's existing, otherwise desktop-only, control receiver.
# Verify: rules 2–5 work; without the shell (playgroundFiles missing) install() returns early and the app
#   behaves as upstream.
# If upstream changes: anchor on where web.rs hands the app to eframe.
- file: apps/*-web/src/**/*.rs
  find: 'Ok\(Box::new\(\w*Shell\b'
  before: |
    // playground (patches/excel.yaml): browser storage.
                        let mut app = app;
                        let (playground_tx, playground_rx) = std::sync::mpsc::channel();
                        app.control_rx = Some(playground_rx);
                        playground::install(&mut app.services, playground_tx, cc.egui_ctx.clone());
                        

# Rule 7/7: the bridge between the app's web services and `playgroundFiles`.
# What it's for: everything above; this is the only code that talks to the page.
# How: install() replaces open_async (rfd) with the explorer, fills save_as_async (rule 1), WEB_WRITE
#   (rule 4) and WEB_NOW_MS (rule 5), and registers onOpen (?open= and Files' "Open in Excel"). Save As
#   answers go out as `file.saveAs {path}` through the control channel (rule 6). Without playgroundFiles it
#   changes nothing.
# Verify: the browser-storage flows above.
# If upstream changes: this is self-contained; keep it at the end of the web crate's main file and adjust
#   the names it uses (Services fields, ControlRequest, Inbox).
- file: apps/*-web/src/web.rs
  find: '$(?![\s\S])'
  before: |

    /// playground (patches/excel.yaml): the bridge between GridCraft's web services and openplayground's
    /// browser file storage, `globalThis.playgroundFiles` (shell/files.js in github.com/daijro/openplayground).
    mod playground {
        use std::sync::mpsc::Sender;

        use gridcraft_ui_egui::{ControlRequest, Inbox, Services};
        use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};

        /// What Excel opens (the list its rfd picker used).
        const OPENS: &[&str] = &["xlsx", "xlsm", "csv", "tsv", "txt", "json"];

        /// Route the app's file services through browser storage. Without the shell (a page not served by
        /// openplayground) nothing changes: the rfd picker and downloads stay.
        pub fn install(services: &mut Services, control: Sender<ControlRequest>, ctx: egui::Context) {
            if api().is_none() {
                log::warn!("playground: no playgroundFiles on this page; keeping downloads");
                return;
            }
            let Some(inbox) = services.inbox.clone() else { return };
            let _ = gridcraft_engine::io::WEB_WRITE.set(write);
            let _ = gridcraft_ui_egui::WEB_NOW_MS.set(js_sys::Date::now);
            let (i, c) = (inbox.clone(), ctx.clone());
            services.open_async = Some(Box::new(move || open(OPENS, i.clone(), c.clone())));
            let c = ctx.clone();
            services.save_as_async = Some(Box::new(move |name: &str, bytes: Vec<u8>| {
                save_as(name, &["xlsx"], &bytes, control.clone(), c.clone(), "file.saveAs");
            }));
            on_open(inbox, ctx);
        }

        fn api() -> Option<JsValue> {
            js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("playgroundFiles")).ok().filter(JsValue::is_object)
        }

        /// `playgroundFiles[method](...args)`; None when the shell is missing or the call threw.
        fn call(method: &str, args: &[JsValue]) -> Option<JsValue> {
            let api = api()?;
            let f = js_sys::Reflect::get(&api, &JsValue::from_str(method)).ok()?.dyn_into::<js_sys::Function>().ok()?;
            f.apply(&api, &args.iter().collect::<js_sys::Array>()).ok()
        }

        fn object(fields: &[(&str, JsValue)]) -> JsValue {
            let o = js_sys::Object::new();
            for (k, v) in fields {
                let _ = js_sys::Reflect::set(&o, &JsValue::from_str(k), v);
            }
            o.into()
        }

        fn list(items: &[&str]) -> JsValue {
            items.iter().map(|s| JsValue::from_str(s)).collect::<js_sys::Array>().into()
        }

        fn field(v: &JsValue, key: &str) -> JsValue {
            js_sys::Reflect::get(v, &JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED)
        }

        /// Await a promise from `call`: None when missing, rejected, or answered null/undefined (cancelled).
        async fn settle(promise: Option<JsValue>) -> Option<JsValue> {
            let promise = promise?.dyn_into::<js_sys::Promise>().ok()?;
            match wasm_bindgen_futures::JsFuture::from(promise).await {
                Ok(v) if !v.is_null() && !v.is_undefined() => Some(v),
                Ok(_) => None,
                Err(e) => {
                    log::error!("playground: {e:?}");
                    None
                }
            }
        }

        /// WEB_WRITE: hand a `browser:` path's bytes to the store, which saves them in the background.
        fn write(path: &str, bytes: &[u8]) -> Result<(), String> {
            call("write", &[JsValue::from_str(path), js_sys::Uint8Array::from(bytes).into()])
                .map(|_| ())
                .ok_or_else(|| format!("{path}: browser storage isn't available"))
        }

        /// A file from the shell ({path, name, bytes}) into the inbox: under its `browser:` path when it has
        /// one, so the workbook keeps it (rule 3), else under its name.
        fn deliver(file: &JsValue, inbox: &Inbox) {
            let name = field(file, "path").as_string().or_else(|| field(file, "name").as_string()).unwrap_or_else(|| "Book.xlsx".into());
            let bytes = js_sys::Uint8Array::new(&field(file, "bytes")).to_vec();
            inbox.lock().unwrap_or_else(|e| e.into_inner()).push((name, bytes));
        }

        fn open(types: &[&str], inbox: Inbox, ctx: egui::Context) {
            let promise = call("open", &[object(&[("types", list(types))])]);
            wasm_bindgen_futures::spawn_local(async move {
                let Some(files) = settle(promise).await else { return };
                for file in js_sys::Array::from(&files).iter() {
                    deliver(&file, &inbox);
                }
                ctx.request_repaint();
            });
        }

        /// Ask Keep / Download. Keep → the app saves to the chosen `browser:` path itself (`command {path}` on
        /// the control channel); Download → the shell has already downloaded `bytes`.
        fn save_as(name: &str, types: &[&str], bytes: &[u8], control: Sender<ControlRequest>, ctx: egui::Context, command: &'static str) {
            let options = object(&[("name", JsValue::from_str(name)), ("types", list(types)), ("bytes", js_sys::Uint8Array::from(bytes).into())]);
            let promise = call("saveAs", &[options]);
            wasm_bindgen_futures::spawn_local(async move {
                let Some(answer) = settle(promise).await else { return };
                let Some(path) = field(&answer, "path").as_string() else { return };
                let (request, _reply) = ControlRequest::new("engine.execute", serde_json::json!({"command": command, "params": {"path": path}}));
                let _ = control.send(request);
                ctx.request_repaint();
            });
        }

        /// Files the shell hands this app: ?open=browser:/… at startup, and "Open in Excel" from Files.
        fn on_open(inbox: Inbox, ctx: egui::Context) {
            let callback = Closure::<dyn FnMut(JsValue)>::new(move |file: JsValue| {
                deliver(&file, &inbox);
                ctx.request_repaint();
            });
            call("onOpen", &[callback.as_ref().clone()]);
            callback.forget();
        }
    }
````

- [ ] **Step 4: Check the rules apply and compile on both channels**

Run: `node scripts/build.mjs check excel release && node scripts/build.mjs check excel head` (with the Task 7 Step 1 environment).
Expected: 8 `patched …` lines per channel, then `excel (release): the patches apply and the app compiles` and the same for `(head)`.

- [ ] **Step 5: Build, install and run the end-to-end test**

Run: `node scripts/build.mjs build excel release && make fetch && E2E=1 node --test --test-name-pattern Excel tests/office.e2e.test.mjs`
Expected: PASS.

- [ ] **Step 6: Check what the test can't**

At `http://localhost:5173/excel/`:
1. Save a workbook to browser storage, then turn on AutoSave with the title-bar switch.
2. Type in a cell and wait about 3 s. The file's time in the Files popup changes without pressing Ctrl+S.
3. Open a second stored workbook. Saving each one writes to its own file.

- [ ] **Step 7: Commit**

```bash
git add patches/excel.yaml tests/office.e2e.test.mjs
git commit -m "Excel: Save, Save As, Open and AutoSave in browser storage" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: PowerPoint saves and opens in browser storage

**Files:**
- Modify: `patches/powerpoint.yaml`, by appending rules 1–6 after the existing theme rule
- Modify: `tests/office.e2e.test.mjs`, by adding the PowerPoint test

**Interfaces:**
- Consumes the `playgroundFiles` contract (Task 5), and these upstream DeckCraft items, verified identical at release `v0.1.0` (942a2c8) and main (d0e57d7):
  - `crates/ui-egui/src/lib.rs`:
    - `pub struct Services { … pub open_async: Option<OpenAsyncFn>` (where `OpenAsyncFn = Box<dyn FnMut(&str)>`)`, … pub inbox: Option<Inbox>, … }`
    - `pub services: Services`
    - `pub fn with_control(mut self, rx)`
    - `save_as_dialog`'s web branch, `} else if let Some(dl) = self.services.download.as_mut() && let Some(d) = self.session.active() { match deckcraft_engine::cmd::file::save_bytes(&d.doc, ext) …`
    - `save()` writes silently when the document has a path.
  - `crates/engine/src/cmd/file.rs`:
    - `fn open_bytes`'s `let i = add_opened(s, name, None, doc);`
    - `#[cfg(target_arch = "wasm32")] fn write_file(_path: &str, _bytes: &[u8]) -> Result<()>`, an error stub
    - `save` → `write_file` → `mark_saved(s, Some(path))`
  - `apps/deckcraft-web/src/web.rs`:
    - the consts `PRESENTATION_EXTS`, `PICTURE_EXTS`, `AUDIO_EXTS` and `VIDEO_EXTS`
    - `Ok(Box::new(WebShell { app, inbox }))`
- Produces: `deckcraft_engine::cmd::file::WEB_WRITE`.
- PowerPoint has no AutoSave, so it gets no clock rule.

- [ ] **Step 1: Add the PowerPoint test to `tests/office.e2e.test.mjs`**

Append:

```js
test('PowerPoint: Save As, Save, Open and Download', { skip: !E2E }, () =>
  roundTrip('powerpoint', {
    savedAs: 'E2E Deck.deckcraft',
    autosave: false, // PowerPoint has no AutoSave
    edit: async (page) => {
      // Saving writes even without changes (save() saves whenever the deck has a path); just focus the app.
      await page.mouse.click(700, 450)
    },
  }))
```

- [ ] **Step 2: Run it to verify it fails**

Run: `E2E=1 node --test --test-name-pattern PowerPoint tests/office.e2e.test.mjs`
Expected: FAIL waiting for "Keep in browser storage".

- [ ] **Step 3: Confirm the save-branch anchor is unique in lib.rs on both channels**

Run:

```bash
for ref in v0.1.0 main; do d=$(mktemp -d); git clone -q --depth 1 --branch $ref https://github.com/storytold/deckcraft $d; grep -c '} else if let Some(dl) = self.services.download.as_mut()' $d/crates/ui-egui/src/lib.rs; rm -rf $d; done
```

Expected: `1` twice. If it is more, the rule will patch the first match only; read the matches and make the regex specific to `save_as_dialog`, e.g. by including the `match deckcraft_engine::cmd::file::save_bytes(&d.doc, ext)` that follows.

- [ ] **Step 4: Append the browser-storage rules to `patches/powerpoint.yaml`**

````yaml

# ══ Browser storage ══════════════════════════════════════════════════════════════════════════════════════
# Rules 1–6 connect DeckCraft's browser build to openplayground's file storage. The site's shell
# (shell/files.js in github.com/daijro/openplayground) gives every app page `globalThis.playgroundFiles`:
#   open({types}) → [{path, name, bytes}] | null          saveAs({name, types, bytes}) → {path} | {download:true} | null
#   write(path, bytes)    read(path) → Promise<bytes>      onOpen(callback)
# Its files have paths like `browser:/Talks/deck.deckcraft`. What the user gets in PowerPoint:
#   - Save on a deck without a file, and Save As, ask "Keep in browser storage / Download to device", then
#     where; the deck then lives at that path (title, unsaved state). Name it .pptx to keep it as PowerPoint.
#   - Save on a browser-storage deck writes back to it silently. (DeckCraft has no AutoSave.)
#   - Open, Insert Picture / Audio / Video use the site's file explorer (with "From computer…"); each open
#     deck keeps its own path.
#   - The shell's ?open=browser:/… and Files' "Open in PowerPoint" open a stored deck.
# If DeckCraft gains its own browser-storage saving, compare it with this list and delete the rules whose
# job it now does (rule 6's bridge last, once nothing calls it) rather than forcing them to match.

# Rule 1/6: the Save As hook the bridge (rule 6) fills in, on the host Services struct.
# What it's for: Save As in the browser has to ask asynchronously (the dialog is a web page); Services only
#   had a synchronous pick_save (None on the web).
# How: save_as_async(suggested name, deck bytes) shows the dialog; a "Keep" answer comes back as
#   `file.saveAs {path}` on the control channel (rule 5).
# Verify: rule 2 compiles and uses it.
# If upstream changes: put it on whatever struct carries the web services (open_async, download, inbox).
- file: crates/ui-egui/src/lib.rs
  find: 'pub inbox: Option<Inbox>,'
  replace: |-
    $&
        /// playground (patches/powerpoint.yaml): ask where to save: the suggested name and the deck's bytes
        /// (for a download). A "Keep" answer comes back as `file.saveAs {path: "browser:/…"}` on the control channel.
        pub save_as_async: Option<Box<dyn FnMut(&str, Vec<u8>)>>,

# Rule 2/6: Save As in the browser build.
# What it's for: Save on a deck without a path and Save As call save_as_dialog, which on the web downloaded
#   the deck straight away. Now it asks Keep / Download.
# How: a new arm in save_as_dialog, between the desktop picker and the download branch, hands the bytes the
#   download branch would have to save_as_async (rule 1). Keep → `file.saveAs {path}` runs the engine's
#   save, which writes through write_file → WEB_WRITE (rule 4) and marks the deck saved at that path. Save on
#   a deck that has a path never comes here: SlideApp::save writes it directly.
# Verify: Ctrl+S on the sample deck → the Keep/Download dialog; Keep → name → Save; Ctrl+S again → no dialog,
#   and the file's time in Files changes.
# If upstream changes: anchor on the web branch of the Save As flow.
- file: crates/ui-egui/src/lib.rs
  find: '\} else if let Some\(dl\) = self\.services\.download\.as_mut\(\)'
  replace: |-
    } else if let Some(ask) = self.services.save_as_async.as_mut()
                && let Some(d) = self.session.active()
            {
                // playground (patches/powerpoint.yaml): Keep in browser storage, or download.
                match deckcraft_engine::cmd::file::save_bytes(&d.doc, ext) {
                    Ok(bytes) => ask(&suggested, bytes),
                    Err(e) => self.set_status(e.to_string()),
                }
            $&

# Rule 3/6: an opened browser-storage deck keeps its path.
# What it's for: so Save writes back to the file it was opened from.
# How: files arrive as file.openBytes {name, data}; the bridge (rule 6) names browser-storage files by their
#   `browser:` path, which open_bytes now keeps as the deck's path (it passed None). The title is still the
#   file's stem.
# Verify: Open a stored deck from the explorer, Ctrl+S: no dialog, and the stored file changes.
# If upstream changes: anchor on where opened bytes become a document.
- file: crates/engine/src/cmd/file.rs
  find: 'let i = add_opened\(s, name, None, doc\);'
  replace: |-
    // playground (patches/powerpoint.yaml): a browser-storage deck keeps its `browser:` path.
        let i = add_opened(s, name, name.starts_with("browser:").then(|| name.to_string()), doc);

# Rule 4/6: where the engine writes `browser:` paths in the browser build.
# What it's for: the engine's save ends in write_file, which in the browser build was an error stub. Now a
#   `browser:` path's bytes go to playgroundFiles.write; other paths still error.
# How: WEB_WRITE is a fn pointer the bridge (rule 6) sets; the engine crate needs no new dependency.
# Verify: rule 2's flow stores the deck; a silent Save changes it.
# If upstream changes: put the hook wherever the wasm build's "write bytes to a path" lives.
- file: crates/engine/src/cmd/file.rs
  find: '(#\[cfg\(target_arch = "wasm32"\)\]\s*fn write_file\((\w+): &str, (\w+): &\[u8\]\) -> Result<\(\)> \{)'
  replace: |-
    /// playground (patches/powerpoint.yaml): where `browser:` paths are written in the browser build. The web
    /// crate's bridge sets it to openplayground's `playgroundFiles.write`; unset, writing errors as upstream.
    pub static WEB_WRITE: std::sync::OnceLock<fn(&str, &[u8]) -> std::result::Result<(), String>> = std::sync::OnceLock::new();

    $1
        if let Some(write) = WEB_WRITE.get()
            && $2.starts_with("browser:")
        {
            return write($2, $3).map_err(EngineError::Other);
        }

# Rule 5/6: switch it on at startup.
# What it's for: the control channel Save As answers come back on, and the bridge (rule 6) installed.
# How: just before the app is handed to eframe (the theme rule above inserts its block at the same anchor);
#   with_control wires the app's existing, otherwise desktop-only, control receiver.
# Verify: rules 2–4 work; without the shell (playgroundFiles missing) install() returns early and the app
#   behaves as upstream.
# If upstream changes: anchor on where web.rs hands the app to eframe.
- file: apps/*-web/src/**/*.rs
  find: 'Ok\(Box::new\(\w*Shell\b'
  before: |
    // playground (patches/powerpoint.yaml): browser storage.
                        let mut app = app;
                        let (playground_tx, playground_rx) = std::sync::mpsc::channel();
                        let mut app = app.with_control(playground_rx);
                        playground::install(&mut app.services, playground_tx, cc.egui_ctx.clone());
                        

# Rule 6/6: the bridge between the app's web services and `playgroundFiles`.
# What it's for: everything above; this is the only code that talks to the page.
# How: install() replaces open_async (rfd) with the explorer for every purpose (open, picture, audio, video),
#   fills save_as_async (rule 1) and WEB_WRITE (rule 4), and registers onOpen (?open= and Files' "Open in
#   PowerPoint"). Save As answers go out as `file.saveAs {path}` through the control channel (rule 5).
#   Without playgroundFiles it changes nothing.
# Verify: the browser-storage flows above.
# If upstream changes: this is self-contained; keep it at the end of the web crate's main file and adjust
#   the names it uses (Services fields, ControlRequest, Inbox, the *_EXTS lists).
- file: apps/*-web/src/web.rs
  find: '$(?![\s\S])'
  before: |

    /// playground (patches/powerpoint.yaml): the bridge between DeckCraft's web services and openplayground's
    /// browser file storage, `globalThis.playgroundFiles` (shell/files.js in github.com/daijro/openplayground).
    mod playground {
        use std::sync::mpsc::Sender;

        use deckcraft_ui_egui::{ControlRequest, Inbox, Services};
        use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};

        /// Route the app's file services through browser storage. Without the shell (a page not served by
        /// openplayground) nothing changes: the rfd picker and downloads stay.
        pub fn install(services: &mut Services, control: Sender<ControlRequest>, ctx: egui::Context) {
            if api().is_none() {
                log::warn!("playground: no playgroundFiles on this page; keeping downloads");
                return;
            }
            let Some(inbox) = services.inbox.clone() else { return };
            let _ = deckcraft_engine::cmd::file::WEB_WRITE.set(write);
            let (i, c) = (inbox.clone(), ctx.clone());
            services.open_async = Some(Box::new(move |purpose: &str| {
                let types = match purpose {
                    "picture" => super::PICTURE_EXTS,
                    "audio" => super::AUDIO_EXTS,
                    "video" => super::VIDEO_EXTS,
                    _ => super::PRESENTATION_EXTS,
                };
                open(types, i.clone(), c.clone());
            }));
            let c = ctx.clone();
            services.save_as_async = Some(Box::new(move |name: &str, bytes: Vec<u8>| {
                save_as(name, &["deckcraft", "pptx"], &bytes, control.clone(), c.clone(), "file.saveAs");
            }));
            on_open(inbox, ctx);
        }

        fn api() -> Option<JsValue> {
            js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("playgroundFiles")).ok().filter(JsValue::is_object)
        }

        /// `playgroundFiles[method](...args)`; None when the shell is missing or the call threw.
        fn call(method: &str, args: &[JsValue]) -> Option<JsValue> {
            let api = api()?;
            let f = js_sys::Reflect::get(&api, &JsValue::from_str(method)).ok()?.dyn_into::<js_sys::Function>().ok()?;
            f.apply(&api, &args.iter().collect::<js_sys::Array>()).ok()
        }

        fn object(fields: &[(&str, JsValue)]) -> JsValue {
            let o = js_sys::Object::new();
            for (k, v) in fields {
                let _ = js_sys::Reflect::set(&o, &JsValue::from_str(k), v);
            }
            o.into()
        }

        fn list(items: &[&str]) -> JsValue {
            items.iter().map(|s| JsValue::from_str(s)).collect::<js_sys::Array>().into()
        }

        fn field(v: &JsValue, key: &str) -> JsValue {
            js_sys::Reflect::get(v, &JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED)
        }

        /// Await a promise from `call`: None when missing, rejected, or answered null/undefined (cancelled).
        async fn settle(promise: Option<JsValue>) -> Option<JsValue> {
            let promise = promise?.dyn_into::<js_sys::Promise>().ok()?;
            match wasm_bindgen_futures::JsFuture::from(promise).await {
                Ok(v) if !v.is_null() && !v.is_undefined() => Some(v),
                Ok(_) => None,
                Err(e) => {
                    log::error!("playground: {e:?}");
                    None
                }
            }
        }

        /// WEB_WRITE: hand a `browser:` path's bytes to the store, which saves them in the background.
        fn write(path: &str, bytes: &[u8]) -> Result<(), String> {
            call("write", &[JsValue::from_str(path), js_sys::Uint8Array::from(bytes).into()])
                .map(|_| ())
                .ok_or_else(|| format!("{path}: browser storage isn't available"))
        }

        /// A file from the shell ({path, name, bytes}) into the inbox: under its `browser:` path when it has
        /// one, so the deck keeps it (rule 3), else under its name.
        fn deliver(file: &JsValue, inbox: &Inbox) {
            let name = field(file, "path").as_string().or_else(|| field(file, "name").as_string()).unwrap_or_else(|| "Presentation".into());
            let bytes = js_sys::Uint8Array::new(&field(file, "bytes")).to_vec();
            inbox.lock().unwrap_or_else(|e| e.into_inner()).push((name, bytes));
        }

        fn open(types: &[&str], inbox: Inbox, ctx: egui::Context) {
            let promise = call("open", &[object(&[("types", list(types))])]);
            wasm_bindgen_futures::spawn_local(async move {
                let Some(files) = settle(promise).await else { return };
                for file in js_sys::Array::from(&files).iter() {
                    deliver(&file, &inbox);
                }
                ctx.request_repaint();
            });
        }

        /// Ask Keep / Download. Keep → the app saves to the chosen `browser:` path itself (`command {path}` on
        /// the control channel); Download → the shell has already downloaded `bytes`.
        fn save_as(name: &str, types: &[&str], bytes: &[u8], control: Sender<ControlRequest>, ctx: egui::Context, command: &'static str) {
            let options = object(&[("name", JsValue::from_str(name)), ("types", list(types)), ("bytes", js_sys::Uint8Array::from(bytes).into())]);
            let promise = call("saveAs", &[options]);
            wasm_bindgen_futures::spawn_local(async move {
                let Some(answer) = settle(promise).await else { return };
                let Some(path) = field(&answer, "path").as_string() else { return };
                let (request, _reply) = ControlRequest::new("engine.execute", serde_json::json!({"command": command, "params": {"path": path}}));
                let _ = control.send(request);
                ctx.request_repaint();
            });
        }

        /// Files the shell hands this app: ?open=browser:/… at startup, and "Open in PowerPoint" from Files.
        fn on_open(inbox: Inbox, ctx: egui::Context) {
            let callback = Closure::<dyn FnMut(JsValue)>::new(move |file: JsValue| {
                deliver(&file, &inbox);
                ctx.request_repaint();
            });
            call("onOpen", &[callback.as_ref().clone()]);
            callback.forget();
        }
    }
````

- [ ] **Step 5: Check the rules apply and compile on both channels**

Run: `node scripts/build.mjs check powerpoint release && node scripts/build.mjs check powerpoint head` (with the Task 7 Step 1 environment).
Expected: 7 `patched …` lines per channel (theme plus 6), then `powerpoint (release): the patches apply and the app compiles` and the same for `(head)`.

- [ ] **Step 6: Build, install and run the end-to-end test**

Run: `node scripts/build.mjs build powerpoint release && make fetch && E2E=1 node --test --test-name-pattern PowerPoint tests/office.e2e.test.mjs`
Expected: PASS.

- [ ] **Step 7: Check what the test can't**

At `http://localhost:5173/powerpoint/`:
1. Insert → Picture opens the explorer.
2. Save As with a name ending `.pptx` stores a `.pptx`, and it reopens.
3. Two decks open from Files save to their own files.

- [ ] **Step 8: Commit**

```bash
git add patches/powerpoint.yaml tests/office.e2e.test.mjs
git commit -m "PowerPoint: Save, Save As and Open in browser storage" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Repairs, the spec, and shipping

**Files:**
- Modify: `.github/workflows/build.yml` (the repair prompt), `docs/superpowers/specs/2026-10-09-browser-files-design.md`

- [ ] **Step 1: Point Claude's repairs at the rules' comments**

In `.github/workflows/build.yml`, the repair step's `prompt:` contains:

```
            matches or the patched code no longer compiles. Update patches/${{ matrix.slug }}.yaml so every rule
            applies and keeps doing what the comment at the top of the file says, on BOTH channels: the same
```

Replace those two lines with:

```
            matches or the patched code no longer compiles. Update patches/${{ matrix.slug }}.yaml so every rule
            applies and keeps doing what its comment says (each rule's comment states what it is for, how it
            works, how to verify it, and what to do if upstream moves or replaces that code; if upstream now
            does a rule's job natively, delete the rule instead of forcing it to match), on BOTH channels: the same
```

- [ ] **Step 2: Bring the spec in line with the contract as built**

In the spec's Shell API table:
- Replace the `open({ types, multiple })` row's first cell with `open({ types })`. Only single files are picked.
- Replace the `saveAs({ name, types })` row with:
  ```
  | `saveAs({ name, types, bytes })` | Asks **Keep in browser storage** or **Download to device**. Keep → explorer in Save mode → `{ path }`. Download → the shell downloads `bytes` as `name` and resolves `{ download: true }`. Cancel → `null`. The app passes its serialized bytes so a download needs no second round trip. |
  ```

- [ ] **Step 3: Run the whole suite**

Run: `npm test && E2E=1 node --test tests/office.e2e.test.mjs`
Expected:
- `npm test` passes `paths`, `store`, `shell`, `explorer`, `files` and `topbar`; `office.e2e` is skipped there.
- The E2E run passes Word, Excel and PowerPoint.

- [ ] **Step 4: Check the theme patches still apply on every patched app**

The Office theme rules share files with the new rules. The other apps' patches are untouched, but re-check them all anyway:

Run: `for a in word excel powerpoint indesign illustrator after-effects; do node scripts/build.mjs check $a release && node scripts/build.mjs check $a head || echo "FAILED $a"; done`
Expected: no `FAILED` lines.

- [ ] **Step 5: Commit and push**

```bash
git add .github/workflows/build.yml docs/superpowers/specs/2026-10-09-browser-files-design.md
git commit -m "Repairs: each patch rule's comment states its purpose; spec matches the saveAs contract" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git pull --rebase && git push
```

- [ ] **Step 6: Watch CI build the patched apps and the site deploy**

Run: `gh run list -R daijro/openplayground -L 5`. Then, when the push-triggered **Build apps** run finishes:

```bash
gh run view <run id> -R daijro/openplayground --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
```

Expected: `build (word, release)`, `build (word, head)` and the excel and powerpoint builds all `success`. Every app rebuilds, because `scripts/build.mjs` didn't change but the patch files did. Only those three apps rebuild.

Then confirm the live site:
1. Check `curl -s https://playground.daijro.dev/shell/apps.json | head -c 200`.
2. Open https://playground.daijro.dev/word/ in a browser and check:
   - the top bar is there;
   - Ctrl+S on a new document shows Keep / Download;
   - Files lists the saved document.

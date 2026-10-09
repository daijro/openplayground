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

// Waits for every queued write at or under `path`, so a save followed by a rename/delete acts on the saved file.
const settle = async (path) => {
  path = normalize(path)
  const under = path === '/' ? '/' : `${path}/`
  await Promise.all([...queues].filter(([key]) => key === path || key.startsWith(under)).map(([, task]) => task.catch(() => {})))
}

export const remove = async (path) => {
  await settle(path)
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
  await Promise.all([settle(from), settle(to)])
  if (await stat(to)) throw new Error(`${baseName(to)} already exists there`)
  try {
    await copy(from, to)
  } catch (e) {
    await remove(to).catch(() => {}) // don't leave a half-copied destination behind
    throw e
  }
  await remove(from)
}

export const usage = async () => {
  const { usage = 0, quota = 0 } = (await navigator.storage.estimate?.()) ?? {}
  return { usage, quota }
}
/** Ask the browser not to clear the storage when the disk runs low. */
export const persist = () => navigator.storage.persist?.().catch(() => false) ?? Promise.resolve(false)

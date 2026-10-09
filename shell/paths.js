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

// EffectCraft reads config/prefs.json (OPFS, else IndexedDB) once at start; write the theme into it first.
// Themes: darker (darkest), dark (default), light. A user's in-app pick is kept: the seed records what it
// set in appearance.seededTheme, and a stored theme that differs from it was chosen in the app.
{
  const want = matchMedia('(prefers-color-scheme: dark)').matches ? 'darker' : 'light'
  const KEY = 'config/prefs.json'
  const seed = (text) => {
    let p
    try { p = JSON.parse(text) } catch {}
    if (!p || typeof p !== 'object' || Array.isArray(p)) p = {}
    const a = p.appearance && typeof p.appearance === 'object' ? p.appearance : {}
    if (a.seededTheme && a.theme && a.theme !== a.seededTheme) return null
    p.appearance = { ...a, theme: want, seededTheme: want }
    return JSON.stringify(p)
  }
  const getDirectory = StorageManager.prototype.getDirectory
  const seeded = (async () => {
    try {
      const dir = await (await getDirectory.call(navigator.storage)).getDirectoryHandle('effectcraft', { create: true })
      const h = await dir.getFileHandle(encodeURIComponent(KEY), { create: true })
      if (!h.createWritable) throw 0
      const old = await (await h.getFile()).text(), next = seed(old)
      if (next && next !== old) { const w = await h.createWritable(); await w.write(next); await w.close() }
    } catch {
      try {
        const db = await new Promise((res, rej) => { const o = indexedDB.open('effectcraft', 1); o.onupgradeneeded = () => o.result.createObjectStore('entries', { keyPath: 'key' }); o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error) })
        const os = () => db.transaction('entries', 'readwrite').objectStore('entries')
        const rec = await new Promise((res) => { const r = os().get(KEY); r.onsuccess = () => res(r.result); r.onerror = () => res(null) })
        const next = seed(rec ? new TextDecoder().decode(rec.data) : '')
        if (next) await new Promise((res) => { const r = os().put({ key: KEY, data: new TextEncoder().encode(next).buffer, modified: Date.now() }); r.onsuccess = r.onerror = res })
        db.close()
      } catch {}
    }
  })()
  // Hold the app's own storage access until the seed is written.
  StorageManager.prototype.getDirectory = async function () {
    await seeded
    return getDirectory.call(this)
  }
}

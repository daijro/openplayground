// Inlined at the top of every app page by fetch.mjs, before the app's own scripts run. fetch.mjs
// defines `tool` just above this: { name, accent } from tools.yaml and `wasm`, each .wasm's unzipped size.

const mb = (bytes) => (bytes / 1e6).toFixed(1)

// Download/unzip progress, shown under the app's own loading text until the .wasm is unpacked.
const progressUI = (total, download) => {
  const box = document.createElement('div')
  box.style.cssText =
    'position:fixed;left:50%;top:calc(50% + 56px);transform:translateX(-50%);z-index:2147483647;display:grid;' +
    'gap:6px;justify-items:center;font:12px/1.4 system-ui,sans-serif;color:#8d8d93;pointer-events:none'
  const bar = document.createElement('progress')
  bar.style.cssText = `width:220px;accent-color:${tool.accent}`
  if (total) bar.max = total
  const label = document.createElement('span')
  box.append(bar, label)
  document.body.append(box)
  return {
    progress(bytes) {
      if (total) bar.value = bytes
      const pct = total ? ` · ${Math.floor((100 * bytes) / total)}%` : ''
      label.textContent = `Downloading and extracting${pct}${download ? ` of ${mb(download)} MB` : ''}`
    },
    done: () => box.remove(),
  }
}

// The .wasm files are stored gzipped (.wasm.gz) to fit the host's 25 MiB file limit: fetch the .gz and
// unzip it on the fly, so the app's loader still sees a normal application/wasm response.
const fetchOriginal = window.fetch
window.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input, location.href)
  if (!url.pathname.endsWith('.wasm')) return fetchOriginal(input, init)
  const total = tool.wasm[url.pathname.split('/').pop()]
  url.pathname += '.gz'
  return fetchOriginal(url, init).then((res) => {
    if (!res.ok) return res
    const ui = progressUI(total, Number(res.headers.get('content-length')))
    // A host that sends Content-Encoding: gzip (Vite's dev server does) has had the browser unzip it already.
    const unzipped = /gzip/.test(res.headers.get('content-encoding') ?? '')
    let received = 0
    const body = (unzipped ? res.body : res.body.pipeThrough(new DecompressionStream('gzip'))).pipeThrough(
      new TransformStream({
        transform(chunk, c) {
          ui.progress((received += chunk.byteLength))
          c.enqueue(chunk)
        },
        flush: ui.done,
      }),
    )
    return new Response(body, { headers: { 'content-type': 'application/wasm' } })
  })
}

// Shared by the tests: the dev site (Vite, in-process, on a free port) and a Chromium to drive it.
import { chromium } from 'playwright-core'
import { createServer as createHttpServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { createServer } from 'vite'

// The system Chromium (Arch: /usr/sbin/chromium); CHROMIUM=... overrides it.
export const CHROMIUM = process.env.CHROMIUM ?? '/usr/sbin/chromium'
// Real-GPU flags (WebGPU on Vulkan) for tests that run the apps themselves; the shell tests don't need them.
export const GPU = ['--use-angle=vulkan', '--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-vulkan=native', '--disable-vulkan-surface']

export async function startSite(root = process.cwd()) {
  const server = await createServer({ root, logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const { port } = server.httpServer.address()
  return { url: `http://localhost:${port}`, close: () => server.close() }
}

// Serve built app artifacts without Vite's development transforms, which can invalidate Trunk's SRI hashes.
export async function startStaticSite(root) {
  const base = resolve(root)
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  }
  const server = createHttpServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      const file = resolve(base, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (file !== base && !file.startsWith(`${base}${sep}`)) {
        response.writeHead(403).end('Forbidden')
        return
      }
      const body = await readFile(file)
      response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body)
    } catch {
      response.writeHead(404).end('Not found')
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
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

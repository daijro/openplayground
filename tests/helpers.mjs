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

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { launch, openPage, startSite, until } from './helpers.mjs'

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
    const item = page.getByRole('menuitem').filter({ has: page.getByText(app.name, { exact: true }) })
    assert.equal(await item.getAttribute('href'), app.head.path)
  }
  await context.close()
})

test('"Alternative naming" shows each card under the name and icon of the app it is an alternative to, and is remembered', async () => {
  const page = await openPage(browser, `${site.url}/`)
  const card = page.locator('.tool', { hasText: 'PhotoCraft' })
  assert.equal(await card.locator('.name').innerText(), 'PhotoCraft')
  assert.equal(await card.getByText('Alternative to Photoshop').isVisible(), true)
  // The sections are kinds of work, the same under either naming.
  const sections = ['IMAGE', 'OFFICE', 'VIDEO', '3D', 'MUSIC', 'OTHER']
  assert.deepEqual(await page.locator('section > h2').allInnerTexts(), sections)
  await page.getByRole('switch', { name: 'Alternative naming' }).click()
  assert.deepEqual(await page.locator('section > h2').allInnerTexts(), sections)
  assert.equal(await card.locator('.name').innerText(), 'Photoshop')
  assert.equal(await card.getByText('Using PhotoCraft').isVisible(), true)
  assert.match(await card.locator('img:visible').first().getAttribute('src'), /alternatives\/photoshop\.png$/)
  await page.reload()
  assert.equal(await page.getByRole('switch', { name: 'Alternative naming' }).isChecked(), true)
  assert.equal(await page.locator('.tool', { hasText: 'Using PhotoCraft' }).locator('.name').innerText(), 'Photoshop')
})

test('?alt=true and ?head=true turn the switches on (head warning the first time), on the dashboard and app pages', async () => {
  const context = await browser.newContext()
  const page = await openPage(browser, `${site.url}/?alt=true&head=true`, { context })
  await page.getByRole('dialog', { name: 'Latest commits are unstable' }).waitFor()
  await page.getByRole('button', { name: 'Use latest commits anyway' }).click()
  assert.equal(await page.getByRole('switch', { name: 'Alternative naming' }).isChecked(), true)
  assert.equal(await page.getByRole('switch', { name: 'Use latest commits' }).isChecked(), true)
  assert.equal(await page.locator('.tool', { hasText: 'Using PhotoCraft' }).locator('.name').innerText(), 'Photoshop')
  await page.goto(`${site.url}/?alt=false&head=false`)
  assert.equal(await page.getByRole('switch', { name: 'Alternative naming' }).isChecked(), false)
  assert.equal(await page.getByRole('switch', { name: 'Use latest commits' }).isChecked(), false)
  await page.goto(`${site.url}${wordPath()}?alt=true`)
  assert.match(await page.locator('.pg-switch').innerText(), /^Word/)
  await context.close()
})

test('with "Alternative naming" on, the switcher and the tab use the alternative names and icons', async () => {
  const context = await browser.newContext()
  await context.addInitScript(() => localStorage.setItem('naming', 'alternative'))
  const page = await openPage(browser, `${site.url}${wordPath()}`, { context })
  const button = page.locator('.pg-switch')
  await button.waitFor()
  assert.match(await button.innerText(), /^Word/)
  assert.match(await button.locator('img').getAttribute('src'), /alternative-icon\.(svg|png)$/)
  assert.equal(await page.title(), 'Word - Playground')
  await button.click()
  const item = page.getByRole('menuitem').filter({ has: page.getByText('Photoshop', { exact: true }) })
  assert.match(await item.innerText(), /Using PhotoCraft/)
  await context.close()
})

test('the version shows this build’s label', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  const word = apps.find((a) => a.slug === 'word')
  const build = word.release ?? word.head
  assert.match(await page.locator('.pg-version').textContent(), new RegExp(build.label.replace(/[.@]/g, '\\$&')))
})

test('Source links the app’s code at this build’s version and the patches at the Playground commit that built it', async () => {
  for (const [slug, channel, repo] of [['word', 'release', 'storytold/wordcraft'], ['onenote', 'head', 'AlienTechSoftware/notecraft']]) {
    const { path } = apps.find((a) => a.slug === slug)[channel]
    const { tag } = JSON.parse(readFileSync(`public${path}.release`, 'utf8'))
    const commit = existsSync(`public${path}.playground-commit`) ? readFileSync(`public${path}.playground-commit`, 'utf8').trim() : 'main'
    const page = await openPage(browser, `${site.url}${path}`)
    await page.getByRole('button', { name: 'Source code' }).click()
    const menu = page.getByRole('menu', { name: 'Source code' })
    const code = menu.getByRole('menuitem', { name: new RegExp(`^${repo}`) })
    assert.equal(await code.getAttribute('href'), `https://github.com/${repo}/tree/${tag.replace(/^head-/, '')}`)
    assert.equal(await code.getAttribute('target'), '_blank')
    assert.equal(await menu.getByRole('menuitem', { name: new RegExp(`^patches/${slug}\\.yaml`) }).getAttribute('href'), `https://github.com/daijro/openplayground/blob/${commit}/patches/${slug}.yaml`)
    await page.context().close()
  }
})

test('License shows the app’s copyright, its licence terms and warranty notice, and that Playground changed it', async () => {
  for (const [slug, terms, warranty] of [
    ['word', /the MIT License or the Apache License, Version 2\.0, at your option/, /without warranty of any kind/],
    ['fl-studio-mobile', /GNU General Public License .*version 3 of the License or \(at your option\) any later version/, /WITHOUT ANY WARRANTY/],
  ]) {
    const app = apps.find((a) => a.slug === slug)
    const build = app.release ?? app.head
    const page = await openPage(browser, `${site.url}${build.path}`)
    await page.getByRole('button', { name: 'License' }).click()
    const text = await page.getByRole('dialog', { name: `${app.name} license` }).innerText()
    assert.ok(app.copyright.length, `${slug} has a copyright line in tools.yaml`)
    for (const line of app.copyright) assert.ok(text.includes(line), `${slug}: ${line}`)
    assert.match(text, terms)
    assert.match(text, warranty)
    if (build.source?.patches.length) assert.match(text, /Playground modified it to run in a browser/)
    await page.keyboard.press('Escape')
    await page.context().close()
  }
})

test('the bar reads Source, License, then Files', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  await page.getByRole('button', { name: 'License' }).waitFor()
  const labels = await page.locator('.pg-bar .pg-bar-btn .pg-label').allInnerTexts()
  assert.deepEqual(labels.filter((l) => ['Source', 'License', 'Files'].includes(l)), ['Source', 'License', 'Files'])
})

test('every app in tools.yaml names its copyright', async () => {
  const { tools } = await import('../scripts/releases.mjs')
  for (const t of tools) assert.ok([t.copyright].flat().filter(Boolean).length, `${t.slug} has no copyright in tools.yaml`)
})

test('Files fans out the stack; its Open Files item opens the explorer popup, and Esc closes it', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  await page.getByRole('button', { name: 'Files' }).click()
  await page.getByRole('menu', { name: 'Recent files' }).waitFor()
  await page.getByRole('menuitem', { name: 'Open Files' }).click()
  await page.getByRole('dialog', { name: 'Files' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Files' }).waitFor({ state: 'detached' })
})

test('fullscreen folds the bar away with its tab showing, and the bar’s button leaves fullscreen', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  await page.getByRole('button', { name: 'Fullscreen' }).click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  await page.locator('.pg-bar').waitFor({ state: 'hidden' })
  assert.equal((await page.locator('body > canvas').first().boundingBox()).y, 0)
  await page.getByRole('button', { name: 'Show the bar' }).click()
  await page.locator('.pg-bar').waitFor()
  assert.equal((await page.locator('body > canvas').first().boundingBox()).y, 36)
  await page.getByRole('button', { name: 'Exit fullscreen' }).click()
  await page.waitForFunction(() => !document.fullscreenElement)
  await page.getByRole('button', { name: 'Fullscreen' }).waitFor()
  assert.equal((await page.locator('body > canvas').first().boundingBox()).y, 36)
})

test('folding the bar in fullscreen isn’t kept: leaving fullscreen brings the bar back as it was', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  await page.getByRole('button', { name: 'Fullscreen' }).click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  await page.getByRole('button', { name: 'Show the bar' }).click()
  await page.getByRole('button', { name: 'Hide the bar' }).click()
  await page.evaluate(() => document.exitFullscreen()) // what Esc does
  await page.waitForFunction(() => !document.fullscreenElement)
  await page.locator('.pg-bar').waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('pg-bar-hidden')), null)
})

test('without the app list, the bar still has Files and Fullscreen', async () => {
  const context = await browser.newContext()
  await context.route('**/shell/apps.json', (r) => r.abort())
  const page = await openPage(browser, `${site.url}${wordPath()}`, { context })
  await page.locator('.pg-bar').waitFor()
  await page.getByRole('button', { name: 'Fullscreen' }).waitFor()
  await page.getByRole('button', { name: 'Files' }).click()
  await page.getByRole('menu', { name: 'Recent files' }).waitFor()
  assert.equal(await page.locator('.pg-switch').count(), 0)
  await context.close()
})

// Keep the shell's leave-warning checks independent of Word's frame-by-frame unsaved reports.
const warningPage = async () => {
  const context = await browser.newContext()
  const url = `${site.url}${wordPath()}`
  await context.route(url, (route) => route.fulfill({
    contentType: 'text/html',
    body: '<link rel="stylesheet" href="/shell/shell.css"><canvas></canvas><script type="module" src="/shell/app.js"></script>',
  }))
  return openPage(browser, url, { context })
}

test('leaving after working in the app asks first', async () => {
  const page = await warningPage()
  await page.locator('.pg-bar').waitFor()
  await page.mouse.click(400, 300)
  await page.keyboard.press('a')
  const dialog = page.waitForEvent('dialog', { timeout: 5000 })
  await page.close({ runBeforeUnload: true })
  const shown = await dialog
  assert.equal(shown.type(), 'beforeunload')
  await shown.accept()
})

test('an app that reports its own state is warned about only when it has unsaved changes', async () => {
  const page = await warningPage()
  await page.locator('.pg-bar').waitFor()
  await page.mouse.click(400, 300)
  await page.keyboard.press('Shift') // input, but no edit
  await page.evaluate(() => playgroundFiles.setUnsaved(false)) // the app says: nothing unsaved
  let asked = false
  page.on('dialog', (d) => ((asked = true), d.accept()))
  await page.close({ runBeforeUnload: true })
  await new Promise((r) => setTimeout(r, 500))
  assert.equal(asked, false, 'warned although the app reported no unsaved changes')

  const second = await warningPage()
  await second.locator('.pg-bar').waitFor()
  await second.mouse.click(400, 300) // gives the page the user activation a beforeunload prompt needs
  await second.evaluate(() => playgroundFiles.setUnsaved(true))
  const dialog = second.waitForEvent('dialog', { timeout: 5000 })
  await second.close({ runBeforeUnload: true })
  const shown = await dialog
  assert.equal(shown.type(), 'beforeunload')
  await shown.accept()
})

test('the bar’s Playground link carries the ArtCraft icon', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  const home = page.getByRole('link', { name: 'Playground' })
  assert.equal(await home.locator('img').getAttribute('src'), '/shell/playground-logo.svg')
})

test('the bar folds away with its arrow, comes back from the tab at the top center, and remembers', async () => {
  const page = await openPage(browser, `${site.url}${wordPath()}`)
  const canvasTop = async () => (await page.locator('body > canvas').first().boundingBox()).y
  await page.getByRole('button', { name: 'Hide the bar' }).click()
  await until(async () => (await canvasTop()) === 0, 10000, 'the app to take the full height')
  await until(async () => !(await page.locator('.pg-bar').isVisible()), 10000, 'the bar to fold away')
  const tab = page.getByRole('button', { name: 'Show the bar' })
  await until(async () => Math.round((await tab.boundingBox())?.y ?? -99) === 0, 10000, 'the tab to drop in')
  const box = await tab.boundingBox()
  assert.ok(Math.abs(box.y) < 1, 'the tab hangs from the top edge')
  assert.ok(Math.abs(box.x + box.width / 2 - page.viewportSize().width / 2) < 2, 'centered')
  await page.reload()
  await tab.waitFor()
  assert.equal(await canvasTop(), 0, 'still hidden after a reload')
  await tab.click()
  await until(async () => (await canvasTop()) === 36, 10000, 'the app to make room for the bar again')
  await until(async () => !(await tab.isVisible()), 10000, 'the tab to leave')
  assert.equal(await page.locator('.pg-bar').isVisible(), true)
})

test('Source offers the app as a standalone page: a ZIP that runs on its own, wasm and all', async (t) => {
  const app = apps.find((a) => a.slug === 'dj-studio')
  const build = app?.head ?? app?.release
  if (!build) return t.skip('MixStudio is not installed')
  const page = await openPage(browser, `${site.url}${build.path}`)
  await page.getByRole('button', { name: 'Source code' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Download as a standalone page/ }).click()])
  const dir = mkdtempSync(join(tmpdir(), 'standalone-'))
  await download.saveAs(join(dir, 'app.zip'))
  execFileSync('unzip', ['-q', 'app.zip'], { cwd: dir })
  const root = join(dir, build.path.split('/').filter(Boolean).pop())
  // The page without the shell but with the Files stand-in; the wasm as stored (gzip), and the notice.
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  assert.ok(!html.includes('/shell/'))
  assert.ok(html.includes('id="playground-standalone"') && html.includes('id="playground-prelude"'))
  const wasm = execFileSync('ls', [root]).toString().split('\n').find((f) => f.endsWith('.wasm.gz'))
  execFileSync('gzip', ['-t', join(root, wasm)])
  assert.match(readFileSync(join(root, 'NOTICE.txt'), 'utf8'), /Copyright \(c\) 2026 soulspin/)
  const readme = readFileSync(join(root, 'README.txt'), 'utf8')
  // Works-on line first, then the systems in order: iOS and iPadOS, Android, ChromeOS, Windows, macOS, Linux.
  assert.match(readme.split('\n').slice(0, 6).join('\n'), /WORKS ON: iPhone and iPad \(iOS, iPadOS\), Android, ChromeOS, Windows, macOS and Linux/)
  const at = ['iPHONE and iPAD (iOS and iPadOS)', '\nANDROID\n', 'CHROMEOS (', '\nWINDOWS\n', '\nmacOS\n', '\nLINUX\n'].map((h) => readme.indexOf(h))
  assert.ok(at.every((i) => i > 0) && at.every((i, n) => !n || i > at[n - 1]), `sections in order: ${at}`)
  for (const part of ['a-Shell', 'Termux', 'Method 1, recommended: the Linux terminal', 'Method 2: a web-server extension', 'Method 3: Android apps', 'Recommended: double-click run.bat', 'sh run.sh']) assert.ok(readme.includes(part), part)
  assert.ok(!/Playground/.test(readme), 'the guide never sends people to the Playground site')
  assert.ok(!/\$\{/.test(readme), 'no template left in the README')
  await page.context().close()

  // Opened from the disk it says what to run, rather than failing on the browser's file:// rules.
  const disk = await browser.newPage()
  await disk.goto(`file://${root}/index.html`)
  const notice = await disk.locator('body').innerText()
  for (const part of ['iPhone and iPad', 'iOS', 'iPadOS', 'Android', 'ChromeOS', 'Windows', 'macOS', 'Linux', 'a-Shell', 'Termux', 'run.bat', 'sh run.sh']) assert.ok(notice.includes(part), `the page names ${part}`)
  assert.ok(notice.indexOf('iPhone') < notice.indexOf('Android') && notice.indexOf('Android') < notice.indexOf('ChromeOS') && notice.indexOf('ChromeOS') < notice.indexOf('Windows'))
  await disk.close()
  assert.ok(statSync(join(root, 'run.sh')).mode & 0o111, 'run.sh is executable')

  // Served by its own serve.py, it starts the app: unzips the wasm, no top bar, and `playgroundFiles` is its own.
  const port = await new Promise((resolve) => { const probe = createServer().listen(0, () => { const { port } = probe.address(); probe.close(() => resolve(port)) }) })
  const server = spawn('python3', ['serve.py', String(port)], { cwd: root, env: { ...process.env, BROWSER: 'true' }, stdio: 'ignore' })
  t.after(() => server.kill())
  await until(() => fetch(`http://localhost:${port}/`).then((r) => r.ok, () => false), 10000, 'serve.py')
  const standalone = await browser.newPage()
  const errors = []
  standalone.on('pageerror', (e) => errors.push(e.message))
  const wasmResponse = standalone.waitForResponse((r) => r.url().endsWith('.wasm.gz'))
  await standalone.goto(`http://localhost:${port}/`)
  assert.equal((await wasmResponse).status(), 200)
  await standalone.locator('canvas').first().waitFor({ timeout: 30000 })
  assert.equal(await standalone.locator('.pg-bar').count(), 0)
  assert.equal(await standalone.evaluate(() => typeof playgroundFiles.open), 'function')
  assert.deepEqual(errors, [])
  await standalone.close()
})

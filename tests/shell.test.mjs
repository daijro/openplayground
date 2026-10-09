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
  assert.ok(word.imports.includes('png'), 'Word inserts pictures')
  const build = word.release ?? word.head
  assert.match(build.path, /^\/(head\/)?word\/$/)
  assert.equal(typeof build.label, 'string')
  for (const g of data.groups) assert.ok(g.apps.length > 0, `group ${g.name} is empty`)
})

test('the dashboard and the Files page use the ArtCraft icon as their favicon', async () => {
  const icon = await fetch(`${site.url}/shell/artcraft-icon.svg`)
  assert.equal(icon.status, 200)
  assert.match(icon.headers.get('content-type'), /image\/svg\+xml/)
  for (const path of ['/', '/files/']) {
    const html = await (await fetch(`${site.url}${path}`)).text()
    assert.match(html, /<link rel="icon"[^>]*href="\/shell\/artcraft-icon\.svg"/, path)
  }
})

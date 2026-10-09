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

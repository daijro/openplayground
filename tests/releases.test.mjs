import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { resolveVersion } from '../scripts/releases.mjs'

const realFetch = globalThis.fetch
afterEach(() => (globalThis.fetch = realFetch))
// GitHub's release list, as resolveVersion sees it.
const serve = (releases) => (globalThis.fetch = async () => ({ ok: true, json: async () => releases }))
const release = (tag_name, published_at, { prerelease = false, asset = `app-${tag_name}-web.zip` } = {}) => ({
  tag_name, published_at, prerelease, draft: false, assets: asset ? [{ name: asset }] : [],
})
const tool = { slug: 'x', repo: 'o/x', asset: '-web\\.zip$' }

test('the release channel takes the newest full release over a newer pre-release', async () => {
  serve([release('v2.0.0-rc1', '2026-03-01', { prerelease: true }), release('v1.0.0', '2026-01-01'), release('v1.1.0', '2026-02-01', { asset: null })])
  assert.equal((await resolveVersion(tool, 'release')).release.tag_name, 'v1.0.0')
})

test('a repo with only pre-releases (with a web build) uses its newest one', async () => {
  serve([release('v0.1.0', '2026-01-01', { prerelease: true }), release('v0.2.0', '2026-02-01', { prerelease: true }), release('v0.3.0', '2026-03-01', { prerelease: true, asset: null })])
  const { release: r, asset } = await resolveVersion(tool, 'release')
  assert.equal(r.tag_name, 'v0.2.0')
  assert.equal(asset.name, 'app-v0.2.0-web.zip')
})

test('no release with a web build: no release channel', async () => {
  serve([release('v0.1.0', '2026-01-01', { prerelease: true, asset: 'app-linux.tar.gz' })])
  assert.equal(await resolveVersion(tool, 'release'), null)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appRedirects } from '../vite.config.js'
import { installDir } from '../scripts/releases.mjs'

test('old product URLs redirect to app names, including channels and nested links', () => {
  const redirects = appRedirects([
    { name: 'Honeydew', slug: 'fl-studio-mobile', release: { path: '/honeydew/' }, head: { path: '/head/honeydew/' } },
    { name: 'PhotoCraft', slug: 'photoshop', release: { path: '/photocraft/' } },
    { name: 'SubCraft', slug: 'substance-painter', head: { path: '/head/subcraft/' } },
    { name: 'LightCraft Classic', slug: 'lightroom-classic', release: { path: '/lightcraft-classic/' } },
    { name: 'Lemon Studio', slug: 'fl-studio', release: { path: '/lemon-studio/' } },
    { name: 'Unavailable', slug: 'missing' },
  ])
  assert.equal(redirects['/fl-studio-mobile'], '/honeydew/')
  assert.equal(redirects['/fl-studio-mobile/'], '/honeydew/')
  assert.equal(redirects['/fl-studio-mobile/*'], '/honeydew/:splat')
  assert.equal(redirects['/head/fl-studio-mobile'], '/head/honeydew/')
  assert.equal(redirects['/head/fl-studio-mobile/*'], undefined, 'head wildcards would pass Cloudflare\'s 100-rule limit')
  assert.equal(redirects['/photoshop'], '/photocraft/')
  assert.equal(redirects['/head/photoshop/'], '/photocraft/')
  assert.equal(redirects['/head/photocraft/'], '/photocraft/')
  assert.equal(redirects['/substance-painter'], '/head/subcraft/')
  assert.equal(redirects['/subcraft'], '/head/subcraft/')
  assert.equal(redirects['/lightroom-classic/'], '/lightcraft-classic/')
  assert.equal(redirects['/fl-studio'], '/lemon-studio/')
  assert.equal(redirects['/honeydew'], undefined)
  assert.equal(redirects['/head/honeydew/'], undefined)
  assert.equal(redirects['/lemon-studio/'], undefined)
  assert.equal(redirects['/missing'], undefined)
  const paths = Object.keys(redirects)
  const firstWildcard = paths.findIndex((path) => path.endsWith('/*'))
  assert.ok(paths.slice(firstWildcard).every((path) => path.endsWith('/*')), 'static redirects must precede all wildcards')
})

test('a legacy alias cannot replace another app’s canonical URL', () => {
  const redirects = appRedirects([
    { name: 'PhotoCraft', slug: 'photoshop', release: { path: '/photocraft/' } },
    { name: 'Photoshop', slug: 'other-app', release: { path: '/photoshop/' } },
  ])
  assert.equal(redirects['/photoshop'], undefined)
  assert.equal(redirects['/other-app'], '/photoshop/')
})

test('installed folders use the app name while build IDs keep their existing slug', () => {
  const app = { name: 'Honeydew', slug: 'fl-studio-mobile' }
  assert.equal(installDir(app, 'release'), 'public/honeydew')
  assert.equal(installDir(app, 'head'), 'public/head/honeydew')
  assert.equal(app.slug, 'fl-studio-mobile')
})

// tools.yaml and GitHub release lookups shared by fetch.mjs and build.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

export const tools = parse(readFileSync('tools.yaml', 'utf8')).groups.flatMap((g) => g.tools)
export const headers = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}
// Cargo build leftovers and precompressed copies some web builds include (LightCraft's site folder is also
// cargo's folder for its `web` profile); _headers/.htaccess only work at the site root.
export const JUNK = /^(build|deps|incremental|examples|\.fingerprint|\.cargo-.*|_headers|\.htaccess|.*\.(gz|br))$/
// A .gz or .br is only junk beside its uncompressed twin: some builds (paint.rs) ship their wasm only gzipped,
// because the plain file is over MAX_FILE, and dropping that copy leaves the page nothing to load.
export const isJunk = (dir, f) => JUNK.test(f) && !(/\.(gz|br)$/.test(f) && !existsSync(join(dir, f.replace(/\.(gz|br)$/, ''))))
// Where build.mjs publishes the patched, optimized builds, as assets of one release.
export const BUILDS = { repo: 'daijro/openplayground', tag: 'builds' }
// The Playground commit whose patches made one of our builds, kept in it (stamp-commit.mjs), for the bar's Source menu.
export const COMMIT_FILE = '.playground-commit'
export const head = () => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

// Retried on network errors and 5xx responses, which GitHub's API gives now and then.
export const github = async (path) => {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.github.com/${path}`, { headers }).catch((e) => (attempt < 3 ? null : Promise.reject(e)))
    if (res?.ok) return res.json()
    if (res && (res.status < 500 || attempt >= 3)) throw new Error(`GitHub API ${res.status} for ${path}: ${await res.text()}`)
    await new Promise((r) => setTimeout(r, attempt * 2000))
  }
}

// Every tool comes in two channels: `release`, its newest upstream release, and `head`, the newest commit on
// its branch. Head builds are named <slug>-head-<commit>-<hash>.zip and installed under public/head/.
export const CHANNELS = ['release', 'head']
export const appSlug = (t) => (t.name ?? t.slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const installDir = (t, channel) => `public/${channel === 'head' ? 'head/' : ''}${appSlug(t)}`
export const alternativeIcon = (t) => ['svg', 'png'].map((ext) => `icons/alternatives/${t.slug}.${ext}`).find(existsSync)

// The version of a tool on a channel, as { release, asset }, or null when the channel has none (a repo
// without web releases has no release channel).
//   release: the newest upstream release (or its pinned `tag:`) with a web build, and that build's asset;
//   head: the newest commit on its `branch:` (default main), or the newest that changed one of its `paths:`, or
//         its pinned `commit:`, with `ref` (the commit), `label` (<branch>@<commit>) and `date`, and no asset:
//         only build.mjs can make its build.
export const resolveVersion = async (t, channel) => {
  if (channel === 'head') {
    if (t.build === false) return null
    const branch = t.branch ?? 'main'
    const newest = t.commit ? await github(`repos/${t.repo}/commits/${t.commit}`) : await Promise.all(
      (t.paths ?? ['']).map((p) => github(`repos/${t.repo}/commits?sha=${branch}&per_page=1${p ? `&path=${encodeURIComponent(p)}` : ''}`)),
    ).then((lists) => lists.flat().sort((a, b) => b.commit.committer.date.localeCompare(a.commit.committer.date))[0])
    if (!newest) return null
    const commit = newest.sha.slice(0, 7)
    return { release: { tag_name: `head-${commit}`, ref: newest.sha, label: `${branch}@${commit}`, date: newest.commit.committer.date }, asset: null }
  }
  const pattern = new RegExp(t.asset ?? '-web-.*\\.zip$')
  const releases = (await github(`repos/${t.repo}/releases?per_page=100`))
    .filter((r) => (t.tag ? r.tag_name === t.tag : !r.draft))
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .filter((r) => r.assets.some((a) => pattern.test(a.name)))
  // Pre-releases count only while a repo has no full release with a web build (SolveCraft's 0.x releases are pre-releases).
  const release = releases.find((r) => t.tag || !r.prerelease) ?? releases[0]
  return release ? { release, asset: release.assets.find((a) => pattern.test(a.name)) } : null
}

// Our builds (ext .zip) or failure markers (.failed) of a tool on a channel, newest first.
export const channelAssets = (assets, t, channel, ext = '.zip') =>
  assets
    .filter((a) => a.name.startsWith(`${t.slug}-`) && a.name.endsWith(ext) && a.name.startsWith(`${t.slug}-head-`) === (channel === 'head'))
    // lightroom-classic's builds are not lightroom's: a longer slug that starts with this one owns its names.
    .filter((a) => !tools.some((o) => o.slug.length > t.slug.length && a.name.startsWith(`${o.slug}-`)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

// Assets of the builds release (none yet if it doesn't exist).
export const builtAssets = async () => {
  try {
    return (await github(`repos/${BUILDS.repo}/releases/tags/${BUILDS.tag}`)).assets
  } catch (e) {
    if (/ 404 /.test(e.message)) return []
    throw e
  }
}

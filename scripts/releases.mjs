// tools.yaml and GitHub release lookups shared by fetch.mjs and build.mjs.
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

export const tools = parse(readFileSync('tools.yaml', 'utf8')).groups.flatMap((g) => g.tools)
export const headers = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}
// Cargo build leftovers and precompressed copies some web builds include (LightCraft's site folder is also
// cargo's folder for its `web` profile); _headers/.htaccess only work at the site root.
export const JUNK = /^(build|deps|incremental|examples|\.fingerprint|\.cargo-.*|_headers|\.htaccess|.*\.(gz|br))$/
// Where build.mjs publishes the patched, optimized builds, as assets of one release.
export const BUILDS = { repo: 'daijro/openplayground', tag: 'builds' }

// Retried on network errors and 5xx responses, which GitHub's API gives now and then.
export const github = async (path) => {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.github.com/${path}`, { headers }).catch((e) => (attempt < 3 ? null : Promise.reject(e)))
    if (res?.ok) return res.json()
    if (res && (res.status < 500 || attempt >= 3)) throw new Error(`GitHub API ${res.status} for ${path}: ${await res.text()}`)
    await new Promise((r) => setTimeout(r, attempt * 2000))
  }
}

// A tool's newest upstream release (or its pinned tag) that has a web build, and that build's asset. A tool
// with `branch:` (a repo without web releases) gets, as a release named <branch>-<commit>, the newest
// commit on that branch that changed one of its `paths:` (any commit without them), with `ref` set to
// the commit and no asset: only build.mjs can make its build.
export const upstreamRelease = async (t) => {
  if (t.branch) {
    const newest = await Promise.all(
      (t.paths ?? ['']).map((p) => github(`repos/${t.repo}/commits?sha=${t.branch}&per_page=1${p ? `&path=${encodeURIComponent(p)}` : ''}`)),
    ).then((lists) => lists.flat().sort((a, b) => b.commit.committer.date.localeCompare(a.commit.committer.date))[0])
    if (!newest) throw new Error(`no commits on ${t.repo} ${t.branch} touch ${t.paths}`)
    const { sha, commit } = newest
    return { release: { tag_name: `${t.branch}-${sha.slice(0, 7)}`, ref: sha, published_at: commit.committer.date }, asset: null }
  }
  const pattern = new RegExp(t.asset ?? '-web-.*\\.zip$')
  const release = (await github(`repos/${t.repo}/releases?per_page=100`))
    .filter((r) => (t.tag ? r.tag_name === t.tag : !r.draft && !r.prerelease))
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .find((r) => r.assets.some((a) => pattern.test(a.name)))
  if (!release) throw new Error(`no ${t.tag ? `release ${t.tag}` : 'release'} of ${t.repo} has an asset matching ${pattern}`)
  return { release, asset: release.assets.find((a) => pattern.test(a.name)) }
}

// Assets of the builds release (none yet if it doesn't exist).
export const builtAssets = async () => {
  try {
    return (await github(`repos/${BUILDS.repo}/releases/tags/${BUILDS.tag}`)).assets
  } catch (e) {
    if (/ 404 /.test(e.message)) return []
    throw e
  }
}

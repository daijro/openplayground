// tools.yaml and GitHub release lookups shared by fetch.mjs and build.mjs.
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

export const tools = parse(readFileSync('tools.yaml', 'utf8')).groups.flatMap((g) => g.tools)
export const headers = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}
// Where build.mjs publishes the patched, optimized builds, as assets of one release.
export const BUILDS = { repo: 'daijro/openplayground', tag: 'builds' }

export const github = async (path) => {
  const res = await fetch(`https://api.github.com/${path}`, { headers })
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}: ${await res.text()}`)
  return res.json()
}

// A tool's newest upstream release (or its pinned tag) that has a web build, and that build's asset.
export const upstreamRelease = async (t) => {
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

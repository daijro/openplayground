// Builds a tool's web app from source at its newest upstream release, with its patches (tools.yaml
// `patches:`) and a speed-first wasm-opt -O3 pass, into out/<slug>-<tag>-<hash>.zip. fetch.mjs installs
// these builds from the `builds` release (BUILDS) and falls back to the upstream release while a build
// is missing or failed.
//
// Every command but plan takes a channel (release or head, see releases.mjs):
//   node scripts/build.mjs plan                    # GitHub Actions output: include=[{slug, channel}] to build
//   node scripts/build.mjs build <slug> <channel>  # build one (needs cargo, trunk and wasm-opt, see build.yml)
//   node scripts/build.mjs check <slug> <channel>  # quick check: the patches apply and the app compiles
//   node scripts/build.mjs facts <slug> <channel>  # GitHub Actions output: its build id and failure history
//   node scripts/build.mjs prune <slug> <channel>  # the published builds to delete (all but the 3 newest)
//
// Patch files hold a list of rules; each edits the first file (matching the `file` glob) where the
// `find` regex matches, and must match, or the build fails:
//   - file: apps/*-web/src/**/*.rs
//     find: 'let\s+mut\s+app\s*=\s*\w+::new\([^;]*\);'
//     after: "\n    app.dark = true;"           # or `before:`, or `replace:` (with $1, $& like String.replace)
//
// Changes too big for rules, like an upstream pull request that isn't merged yet, are diffs in the folder
// next to the patch file: patches/<slug>/<name>.diff, or <name>.<channel>.diff to use on that channel
// instead. They apply before the rules, with `git apply --recount` (so hunk line counts needn't be exact),
// and must apply, or the build fails. One upstream already has (it applies in reverse) is skipped; once the
// newest release has it, `build` lists its files in out/<slug>.merged and build.yml deletes them. An empty
// diff is skipped too (build.yml deletes it when committing a repair).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { applyDiffs, diffDir } from './diffs.mjs'
import { CHANNELS, JUNK, builtAssets, channelAssets, resolveVersion, tools } from './releases.mjs'

const WASM_OPT = process.env.WASM_OPT || 'wasm-opt'
// Rust's default wasm32 features. wasm-opt reads them from the module's target_features section, which
// some builds strip; without them it assumes the 2017 baseline and rejects e.g. memory.copy.
// Plus simd, which prepare() turns on (see SIMD).
const WASM_FEATURES = ['bulk-memory', 'bulk-memory-opt', 'call-indirect-overlong', 'multivalue', 'mutable-globals', 'nontrapping-float-to-int', 'reference-types', 'sign-ext', 'simd'].map((f) => `--enable-${f}`)
// Wasm SIMD (simd128), which Rust leaves off by default: the apps' CPU rendering (e.g. vello_cpu, which
// redraws InDesign's page at every zoom step) runs 3-5x faster with it, and every current browser has it
// (Chrome 91, Firefox 89, Safari 16.4; all with WebGPU). It goes in a cargo config in the folder above the
// checkout, which cargo merges with the app's own (rustflags arrays add up); RUSTFLAGS would replace the app's.
const SIMD = '[target.wasm32-unknown-unknown]\nrustflags = ["-Ctarget-feature=+simd128"]\n'

// Changes when the build recipe or the tool's patches change, so either one triggers a rebuild.
const buildHash = (t) =>
  createHash('sha256')
    .update(readFileSync(import.meta.filename))
    .update(readFileSync(new URL('diffs.mjs', import.meta.url)))
    .update(t.patches ? readFileSync(t.patches) : '')
    .update(diffDir(t) ? readdirSync(diffDir(t)).sort().map((f) => f + readFileSync(join(diffDir(t), f), 'utf8')).join('') : '')
    .digest('hex')
    .slice(0, 8)
export const buildId = (t, tag) => `${t.slug}-${tag}-${buildHash(t)}`

const run = (cmd, args, opts = {}) => {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { stdio: 'inherit', ...opts })
}

const applyPatches = (src, file) => {
  for (const rule of parse(readFileSync(file, 'utf8'))) {
    const re = new RegExp(rule.find, 'm')
    const hit = globSync(rule.file, { cwd: src }).find((f) => re.test(readFileSync(join(src, f), 'utf8')))
    if (!hit) throw new Error(`${file}: no ${rule.file} matches /${rule.find}/`)
    const text = readFileSync(join(src, hit), 'utf8')
    const edit = rule.replace !== undefined ? rule.replace : (m) => (rule.before ?? '') + m + (rule.after ?? '')
    writeFileSync(join(src, hit), text.replace(re, edit))
    console.log(`patched ${hit} at /${rule.find}/`)
  }
}

// The wasm-bindgen CLI must match the crate version in Cargo.lock exactly; trunk fetches its own, but
// `cargo xtask web` uses the one on PATH. Returns a PATH with the right one first.
const wasmBindgenPath = (src, cache) => {
  const version = readFileSync(join(src, 'Cargo.lock'), 'utf8').match(/name = "wasm-bindgen"\nversion = "([^"]+)"/)?.[1]
  const onPath = (() => { try { return execFileSync('wasm-bindgen', ['--version'], { encoding: 'utf8' }) } catch { return '' } })()
  if (!version || onPath.includes(version)) return process.env.PATH
  const dir = join(cache, `wasm-bindgen-${version}`)
  if (!existsSync(join(dir, 'wasm-bindgen'))) {
    mkdirSync(dir, { recursive: true })
    const name = `wasm-bindgen-${version}-x86_64-unknown-linux-musl`
    run('sh', ['-c', `curl -sSfL https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${version}/${name}.tar.gz | tar -xz -C "${dir}" --strip-components=1`])
  }
  return `${dir}:${process.env.PATH}`
}

const toolFor = (slug) => tools.find((t) => t.slug === slug) ?? fail(`no tool ${slug} in tools.yaml`)
const fail = (message) => {
  throw new Error(message)
}

// A fresh checkout of the tool's version on a channel in <work>/<dir>, with its patches applied (unless patch is false).
const prepare = async (slug, channel, { dir = 'src', patch = true } = {}) => {
  const t = toolFor(slug)
  const { release } = (await resolveVersion(t, channel)) ?? fail(`${slug} has no ${channel} version`)
  const work = process.env.BUILD_DIR ? resolve(process.env.BUILD_DIR, `${slug}-${channel}`) : mkdtempSync(join(tmpdir(), `build-${slug}-`))
  // A throwaway temp dir (1-2 GB of target/) goes when we're done, pass or fail; BUILD_DIR is kept as a cache.
  if (!process.env.BUILD_DIR) process.on('exit', () => rmSync(work, { recursive: true, force: true }))
  const src = join(work, dir)
  rmSync(src, { recursive: true, force: true })
  mkdirSync(join(work, '.cargo'), { recursive: true })
  writeFileSync(join(work, '.cargo', 'config.toml'), SIMD)
  if (release.ref) {
    // A commit (the head channel): fetch exactly that one.
    run('git', ['init', '--quiet', src])
    run('git', ['-C', src, 'fetch', '--quiet', '--depth', '1', `https://github.com/${t.repo}.git`, release.ref])
    run('git', ['-C', src, 'checkout', '--quiet', 'FETCH_HEAD'])
  } else {
    run('git', ['clone', '--quiet', '--depth', '1', '--branch', release.tag_name, `https://github.com/${t.repo}.git`, src])
  }
  const merged = patch ? applyDiffs(src, t, channel) : []
  if (t.patches && patch) applyPatches(src, t.patches)
  const web = globSync('apps/*-web/Cargo.toml', { cwd: src }).map((f) => join(src, f, '..'))[0] ?? fail(`${t.repo} has no apps/*-web crate`)
  return { t, id: buildId(t, release.tag_name), work, src, web, merged }
}

const check = async (slug, channel) => {
  if (!(await resolveVersion(toolFor(slug), channel))) return console.log(`${slug} has no ${channel} version: nothing to check`)
  const { work, web } = await prepare(slug, channel)
  run('cargo', ['check', '--target', 'wasm32-unknown-unknown'], { cwd: web, env: { ...process.env, CARGO_TARGET_DIR: join(work, 'target') } })
  console.log(`${slug} (${channel}): the patches apply and the app compiles`)
}

const build = async (slug, channel) => {
  const { id, work, src, web, merged } = await prepare(slug, channel)
  // The newest release has them, so the newest commit does too: they've done their job (build.yml deletes them).
  if (channel === 'release' && merged.length) {
    mkdirSync('out', { recursive: true })
    writeFileSync(join('out', `${slug}.merged`), merged.join('\n') + '\n')
  }
  const dist = join(work, 'dist')
  rmSync(dist, { recursive: true, force: true })
  if (existsSync(join(web, 'Trunk.toml'))) {
    // Skip trunk's own wasm-opt (the apps ask for -Oz, size first): the pass below optimizes for speed.
    const index = join(web, 'index.html')
    writeFileSync(index, readFileSync(index, 'utf8').replace(/data-wasm-opt="[^"]*"/g, 'data-wasm-opt="0"'))
    run('trunk', ['build', '--release', '--dist', dist, '--public-url', './'], { cwd: web, env: { ...process.env, CARGO_TARGET_DIR: join(work, 'target') } })
  } else {
    // `cargo xtask web` writes the site to <target>/web/dist or, in some releases, <target>/web (and runs
    // wasm-opt -O2 if it is on PATH: keep it off).
    const target = join(work, 'target')
    run('cargo', ['xtask', 'web'], { cwd: src, env: { ...process.env, CARGO_TARGET_DIR: target, PATH: wasmBindgenPath(src, join(work, 'tools')) } })
    const site = [join(target, 'web', 'dist'), join(target, 'web')].find((d) => existsSync(join(d, 'index.html')))
    if (!site) throw new Error('cargo xtask web left no index.html in <target>/web/dist or <target>/web')
    for (const f of readdirSync(site)) if (!JUNK.test(f)) cpSync(join(site, f), join(dist, f), { recursive: true })
  }

  for (const f of readdirSync(dist, { recursive: true }).filter((f) => f.endsWith('.wasm'))) {
    try {
      run(WASM_OPT, ['-O3', '--strip-debug', ...WASM_FEATURES, join(dist, f), '-o', join(dist, f)])
    } catch {
      console.log(`::warning::${slug}: wasm-opt failed on ${f}, shipping it unoptimized`)
    }
  }

  mkdirSync('out', { recursive: true })
  rmSync(join(work, id), { recursive: true, force: true })
  cpSync(dist, join(work, id), { recursive: true })
  run('zip', ['-qr9', resolve('out', `${id}.zip`), id], { cwd: work })
  console.log(`built out/${id}.zip`)
}

const DAY = 24 * 3600e3
const age = (asset) => Date.now() - Date.parse(asset.created_at)
const [command, slug, channel] = process.argv.slice(2)
if (command === 'plan') {
  // To build: each tool's channels whose build is missing, unless it failed (<id>.failed) in the last day.
  // Failures are retried daily, and at once when the version or the patches change (a new id).
  const assets = await builtAssets()
  const has = (name, maxAge = Infinity) => assets.some((a) => a.name === name && age(a) < maxAge)
  const include = []
  for (const t of tools) {
    for (const channel of CHANNELS) {
      const version = await resolveVersion(t, channel)
      const id = version && buildId(t, version.release.tag_name)
      if (id && !has(`${id}.zip`) && !has(`${id}.failed`, DAY)) include.push({ slug: t.slug, channel })
    }
  }
  console.log(`include=${JSON.stringify(include)}`)
} else if (command === 'facts' && slug && CHANNELS.includes(channel)) {
  // failed_today: a failure in the last day (Claude repairs once a day); failed_before: one over ~a day ago,
  // so this app has been failing for over a day.
  const t = toolFor(slug)
  const failures = channelAssets(await builtAssets(), t, channel, '.failed')
  const version = await resolveVersion(t, channel)
  console.log(`id=${version ? buildId(t, version.release.tag_name) : ''}`)
  console.log(`failed_today=${failures.some((a) => age(a) < DAY)}`)
  console.log(`failed_before=${failures.some((a) => age(a) > DAY - 3600e3)}`)
} else if (command === 'prune' && slug && CHANNELS.includes(channel)) {
  // Everything but the channel's newest build: fetch only ever installs that one.
  for (const a of channelAssets(await builtAssets(), toolFor(slug), channel).slice(1)) console.log(a.name)
} else if (command === 'source' && slug && CHANNELS.includes(channel)) {
  // The unpatched upstream code, for repairing the patches against (in <BUILD_DIR>/<slug>-<channel>/upstream).
  if (await resolveVersion(toolFor(slug), channel)) await prepare(slug, channel, { dir: 'upstream', patch: false })
} else if (command === 'check' && slug && CHANNELS.includes(channel)) {
  await check(slug, channel)
} else if (command === 'build' && slug && CHANNELS.includes(channel)) {
  await build(slug, channel)
} else {
  console.error('usage: node scripts/build.mjs plan | build|check|source|facts|prune <slug> release|head')
  process.exit(2)
}

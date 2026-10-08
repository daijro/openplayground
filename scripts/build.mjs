// Builds a tool's web app from source at its newest upstream release, with its patches (tools.yaml
// `patches:`) and a speed-first wasm-opt -O3 pass, into out/<slug>-<tag>-<hash>.zip. fetch.mjs installs
// these builds from the `builds` release (BUILDS) and falls back to the upstream release while a build
// is missing or failed.
//
//   node scripts/build.mjs plan          # GitHub Actions output: slugs=[...] still to build
//   node scripts/build.mjs build <slug>  # build one (needs cargo, trunk and wasm-opt, see build.yml)
//   node scripts/build.mjs check <slug>  # quick check: the patches apply and the app compiles
//   node scripts/build.mjs id <slug>     # the build id (zip name) of the newest release
//
// Patch files hold a list of rules; each edits the first file (matching the `file` glob) where the
// `find` regex matches, and must match, or the build fails:
//   - file: apps/*-web/src/**/*.rs
//     find: 'let\s+mut\s+app\s*=\s*\w+::new\([^;]*\);'
//     after: "\n    app.dark = true;"           # or `before:`, or `replace:` (with $1, $& like String.replace)
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { JUNK, builtAssets, tools, upstreamRelease } from './releases.mjs'

const WASM_OPT = process.env.WASM_OPT || 'wasm-opt'
// Rust's default wasm32 features. wasm-opt reads them from the module's target_features section, which
// some builds strip; without them it assumes the 2017 baseline and rejects e.g. memory.copy.
const WASM_FEATURES = ['bulk-memory', 'bulk-memory-opt', 'call-indirect-overlong', 'multivalue', 'mutable-globals', 'nontrapping-float-to-int', 'reference-types', 'sign-ext'].map((f) => `--enable-${f}`)

// Changes when the build recipe or the tool's patches change, so either one triggers a rebuild.
const buildHash = (t) =>
  createHash('sha256')
    .update(readFileSync(import.meta.filename))
    .update(t.patches ? readFileSync(t.patches) : '')
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

// A fresh checkout of the tool's newest release in <work>/src, with its patches applied.
const prepare = async (slug) => {
  const t = toolFor(slug)
  const { release } = await upstreamRelease(t)
  const work = process.env.BUILD_DIR ? resolve(process.env.BUILD_DIR, slug) : mkdtempSync(join(tmpdir(), `build-${slug}-`))
  const src = join(work, 'src')
  rmSync(src, { recursive: true, force: true })
  if (release.ref) {
    // A commit (tools with `branch:`): fetch exactly that one.
    run('git', ['init', '--quiet', src])
    run('git', ['-C', src, 'fetch', '--quiet', '--depth', '1', `https://github.com/${t.repo}.git`, release.ref])
    run('git', ['-C', src, 'checkout', '--quiet', 'FETCH_HEAD'])
  } else {
    run('git', ['clone', '--quiet', '--depth', '1', '--branch', release.tag_name, `https://github.com/${t.repo}.git`, src])
  }
  if (t.patches) applyPatches(src, t.patches)
  const web = globSync('apps/*-web/Cargo.toml', { cwd: src }).map((f) => join(src, f, '..'))[0] ?? fail(`${t.repo} has no apps/*-web crate`)
  return { t, id: buildId(t, release.tag_name), work, src, web }
}

const check = async (slug) => {
  const { work, web } = await prepare(slug)
  run('cargo', ['check', '--target', 'wasm32-unknown-unknown'], { cwd: web, env: { ...process.env, CARGO_TARGET_DIR: join(work, 'target') } })
  console.log(`${slug}: the patches apply and the app compiles`)
}

const build = async (slug) => {
  const { id, work, src, web } = await prepare(slug)
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

const [command, slug] = process.argv.slice(2)
if (command === 'plan') {
  // To build: tools whose build is missing, unless it failed (<id>.failed) in the last day. Failures are
  // retried daily, and at once when the release or the patches change (a new id).
  const assets = await builtAssets()
  const has = (name, maxAge = Infinity) => assets.some((a) => a.name === name && Date.now() - Date.parse(a.created_at) < maxAge)
  const todo = []
  for (const t of tools) {
    const id = buildId(t, (await upstreamRelease(t)).release.tag_name)
    if (!has(`${id}.zip`) && !has(`${id}.failed`, 24 * 3600e3)) todo.push(t.slug)
  }
  console.log(`slugs=${JSON.stringify(todo)}`)
} else if (command === 'id' && slug) {
  console.log(buildId(toolFor(slug), (await upstreamRelease(toolFor(slug))).release.tag_name))
} else if (command === 'check' && slug) {
  await check(slug)
} else if (command === 'build' && slug) {
  await build(slug)
} else {
  console.error('usage: node scripts/build.mjs plan | build <slug> | check <slug> | id <slug>')
  process.exit(2)
}

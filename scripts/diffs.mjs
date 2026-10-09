// A tool's diffs (patches/<slug>/<name>.diff, or <name>.<channel>.diff on that channel): see scripts/build.mjs.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CHANNELS } from './releases.mjs'

// The tool's diffs folder (patches/<slug>/), if it has one.
export const diffDir = (t) => (t.patches && existsSync(t.patches.replace(/\.yaml$/, '')) ? t.patches.replace(/\.yaml$/, '') : null)
const diffName = (f) => f.replace(new RegExp(`(\\.(${CHANNELS.join('|')}))?\\.diff$`), '')

// Applies the channel's diffs to the git checkout `src`; returns the files of those upstream already has.
export const applyDiffs = (src, t, channel) => {
  const dir = diffDir(t)
  if (!dir) return []
  const files = readdirSync(dir).filter((f) => f.endsWith('.diff'))
  const upstream = []
  for (const name of [...new Set(files.map(diffName))].sort()) {
    const file = [`${name}.${channel}.diff`, `${name}.diff`].find((f) => files.includes(f))
    if (!file || !readFileSync(join(dir, file), 'utf8').trim()) continue
    const apply = (...args) => spawnSync('git', ['apply', '--recount', ...args, resolve(dir, file)], { cwd: src, encoding: 'utf8' })
    const check = apply('--check')
    if (check.status === 0) {
      const applied = apply()
      if (applied.status !== 0) throw new Error(`${dir}/${file}: git apply failed:\n${applied.stderr}`)
      console.log(`applied ${dir}/${file}`)
    } else if (apply('--reverse', '--check').status === 0) {
      console.log(`${dir}/${file}: upstream has it already, skipped`)
      upstream.push(...files.filter((f) => diffName(f) === name).map((f) => join(dir, f)))
    } else throw new Error(`${dir}/${file} no longer applies:\n${check.stderr}`)
  }
  return upstream
}

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { applyDiffs } from '../scripts/diffs.mjs'

const roots = []
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

// A checkout whose a.txt holds `text`, and a tool whose patches/x/ folder holds `diffs` ({file name: diff}).
const setup = (text, diffs) => {
  const root = mkdtempSync(join(tmpdir(), 'diffs-'))
  roots.push(root)
  const src = join(root, 'src')
  mkdirSync(src)
  execFileSync('git', ['init', '-q', src])
  writeFileSync(join(src, 'a.txt'), text)
  mkdirSync(join(root, 'patches', 'x'), { recursive: true })
  for (const [name, diff] of Object.entries(diffs)) writeFileSync(join(root, 'patches', 'x', name), diff)
  return { src, t: { slug: 'x', patches: join(root, 'patches', 'x.yaml') }, read: () => readFileSync(join(src, 'a.txt'), 'utf8') }
}
// a.txt's middle line `from` → `to` (hunk counts deliberately wrong: applied with --recount).
const change = (from, to) => `A header, as the diffs have.\n\ndiff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,9 @@\n one\n-${from}\n+${to}\n three\n`

test('a diff applies', () => {
  const { src, t, read } = setup('one\ntwo\nthree\n', { 'pr-1.diff': change('two', 'TWO') })
  assert.deepEqual(applyDiffs(src, t, 'release'), [])
  assert.equal(read(), 'one\nTWO\nthree\n')
})

test("a diff upstream already has is skipped and returned, with its channel's variants", () => {
  const { src, t, read } = setup('one\nTWO\nthree\n', { 'pr-1.diff': change('two', 'TWO'), 'pr-1.head.diff': change('2', 'TWO') })
  assert.deepEqual(applyDiffs(src, t, 'release').map((f) => f.split('/').pop()).sort(), ['pr-1.diff', 'pr-1.head.diff'])
  assert.equal(read(), 'one\nTWO\nthree\n')
})

test('a diff that no longer applies fails', () => {
  const { src, t } = setup('one\nchanged\nthree\n', { 'pr-1.diff': change('two', 'TWO') })
  assert.throws(() => applyDiffs(src, t, 'release'), /pr-1\.diff no longer applies/)
})

test("a channel's own variant replaces the diff on that channel only", () => {
  const diffs = { 'pr-1.diff': change('two', 'TWO'), 'pr-1.head.diff': change('2', 'TWO') }
  const head = setup('one\n2\nthree\n', diffs)
  applyDiffs(head.src, head.t, 'head')
  assert.equal(head.read(), 'one\nTWO\nthree\n')
  const release = setup('one\ntwo\nthree\n', diffs)
  applyDiffs(release.src, release.t, 'release')
  assert.equal(release.read(), 'one\nTWO\nthree\n')
})

test('an empty diff is skipped, and a variant alone applies nowhere else', () => {
  const { src, t, read } = setup('one\ntwo\nthree\n', { 'pr-1.diff': '', 'pr-2.head.diff': change('two', 'TWO') })
  assert.deepEqual(applyDiffs(src, t, 'release'), [])
  assert.equal(read(), 'one\ntwo\nthree\n')
})

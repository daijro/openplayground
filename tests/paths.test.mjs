import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ancestry, appFor, baseName, extOf, formatSize, formatWhen, fromAppPath, join, matchesTypes, normalize,
  parentOf, toAppPath, uniqueName, validName, withType,
} from '../shell/paths.js'

test('normalize keeps paths absolute and drops empty, . and .. segments', () => {
  assert.equal(normalize(''), '/')
  assert.equal(normalize('a//b/./c/'), '/a/b/c')
  assert.equal(normalize('/a/../b'), '/a/b')
  assert.equal(normalize('\\a\\b'), '/a/b')
})

test('app paths carry the browser: scheme', () => {
  assert.equal(toAppPath('/Reports/budget.xlsx'), 'browser:/Reports/budget.xlsx')
  assert.equal(fromAppPath('browser:/Reports/budget.xlsx'), '/Reports/budget.xlsx')
  assert.equal(fromAppPath('budget.xlsx'), null)
  assert.equal(fromAppPath(null), null)
})

test('names and folders', () => {
  assert.equal(baseName('/a/b/Q3 report (final).v2.docx'), 'Q3 report (final).v2.docx')
  assert.equal(parentOf('/a/b/c.txt'), '/a/b')
  assert.equal(parentOf('/c.txt'), '/')
  assert.equal(join('/a', 'b.txt'), '/a/b.txt')
  assert.equal(join('/', 'b.txt'), '/b.txt')
  assert.deepEqual(ancestry('/a/b'), ['/', '/a', '/a/b'])
  assert.deepEqual(ancestry('/'), ['/'])
})

test('extensions', () => {
  assert.equal(extOf('Q3 report (final).v2.DOCX'), 'docx')
  assert.equal(extOf('Résumé'), '')
  assert.equal(extOf('.hidden'), '')
  assert.equal(matchesTypes('a.xlsx', ['xlsx', 'csv']), true)
  assert.equal(matchesTypes('a.docx', ['xlsx']), false)
  assert.equal(matchesTypes('a.docx', []), true)
  assert.equal(withType('Budget', ['xlsx']), 'Budget.xlsx')
  assert.equal(withType('Budget.xlsx', ['xlsx']), 'Budget.xlsx')
  assert.equal(withType('Notes.odt', ['docx', 'odt']), 'Notes.odt')
  assert.equal(withType('Q3 report (final).v2', ['docx']), 'Q3 report (final).v2.docx')
  assert.equal(withType('Anything', []), 'Anything')
})

test('valid names', () => {
  for (const ok of ['Budget.xlsx', 'Résumé', 'Q3 report (final).v2.docx', '  spaced  ']) assert.equal(validName(ok), true, ok)
  for (const bad of ['', '   ', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b', 'a\u0001b']) assert.equal(validName(bad), false, bad)
})

test('uniqueName counts up before the extension', () => {
  assert.equal(uniqueName('Report.docx', new Set()), 'Report.docx')
  assert.equal(uniqueName('Report.docx', new Set(['Report.docx'])), 'Report (2).docx')
  assert.equal(uniqueName('Report.docx', new Set(['Report.docx', 'Report (2).docx'])), 'Report (3).docx')
  assert.equal(uniqueName('New folder', new Set(['New folder'])), 'New folder (2)')
})

test('sizes and times', () => {
  assert.equal(formatSize(0), '0 B')
  assert.equal(formatSize(999), '999 B')
  assert.equal(formatSize(1500), '1.5 KB')
  assert.equal(formatSize(12_000), '12 KB')
  assert.equal(formatSize(999_999), '1.0 MB')
  assert.equal(formatSize(3_400_000_000), '3.4 GB')
  const now = Date.parse('2026-10-09T12:00:00Z')
  assert.equal(formatWhen(now - 5_000, now), 'just now')
  assert.equal(formatWhen(now - 5 * 60_000, now), '5 minutes ago')
  assert.equal(formatWhen(now - 3 * 3_600_000, now), '3 hours ago')
  assert.equal(formatWhen(Date.parse('2026-10-07T12:00:00Z'), now), 'Oct 7')
  assert.equal(formatWhen(Date.parse('2025-03-01T12:00:00Z'), now), 'Mar 1, 2025')
})

test('appFor picks the first app that opens the type', () => {
  const apps = [{ slug: 'photoshop', opens: ['psd', 'png'] }, { slug: 'word', opens: ['docx'] }, { slug: 'powerpoint', opens: ['pptx', 'png'] }]
  assert.equal(appFor(apps, 'a.PNG').slug, 'photoshop')
  assert.equal(appFor(apps, 'a.docx').slug, 'word')
  assert.equal(appFor(apps, 'a.zip'), null)
})

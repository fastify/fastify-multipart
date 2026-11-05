'use strict'

const { test } = require('node:test')
const { safeExtension } = require('../lib/sanitize')

test('keeps well-formed alphanumeric extensions', t => {
  t.plan(6)
  t.assert.strictEqual(safeExtension('a.txt'), '.txt')
  t.assert.strictEqual(safeExtension('photo.JPG'), '.JPG')
  t.assert.strictEqual(safeExtension('archive.tar.gz'), '.gz')
  t.assert.strictEqual(safeExtension('data.2024'), '.2024')
  t.assert.strictEqual(safeExtension('notes.md'), '.md')
  // only a 16-char alphanumeric extension is kept
  t.assert.strictEqual(safeExtension('file.verylongext1'), '.verylongext1')
})

test('drops unsafe characters that appear in the extension', t => {
  t.plan(7)
  // ':' starts an NTFS alternate data stream -> must not reach the temp path
  t.assert.strictEqual(safeExtension('a.txt:s'), '')
  // Windows reserved characters inside the extension
  t.assert.strictEqual(safeExtension('a.txt?'), '')
  t.assert.strictEqual(safeExtension('a.txt*'), '')
  t.assert.strictEqual(safeExtension('a.txt<'), '')
  t.assert.strictEqual(safeExtension('a.txt|'), '')
  t.assert.strictEqual(safeExtension('a.txt>'), '')
  t.assert.strictEqual(safeExtension('a.txt:s:more'), '')
})

test('drops trailing-dot, non-ascii and over-long extensions', t => {
  t.plan(4)
  t.assert.strictEqual(safeExtension('a.txt.'), '')
  t.assert.strictEqual(safeExtension('a..'), '')
  t.assert.strictEqual(safeExtension('photo.😀'), '')
  // extension longer than 16 characters is dropped
  t.assert.strictEqual(safeExtension('file.abcdefghijklmnopq'), '')
})

test('drops missing extensions', t => {
  t.plan(3)
  t.assert.strictEqual(safeExtension('Dockerfile'), '')
  t.assert.strictEqual(safeExtension('makefile'), '')
  t.assert.strictEqual(safeExtension('.gitignore'), '')
})

test('handles separators gracefully (filename is already basenamed)', t => {
  t.plan(2)
  t.assert.strictEqual(safeExtension('a.txt/../b'), '')
  t.assert.strictEqual(safeExtension('a.txt\\..\\b'), '')
})

test('handles falsy input', t => {
  t.plan(2)
  t.assert.strictEqual(safeExtension(undefined), '')
  t.assert.strictEqual(safeExtension(''), '')
})

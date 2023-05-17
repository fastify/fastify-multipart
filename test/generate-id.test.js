'use strict'

const { test } = require('tap')
const { generateId } = require('../lib/generateId')

test('returns', t => {
  t.plan(3)
  t.type(generateId, 'function', 'is a function')
  t.type(generateId(), 'string', '~> returns a string')
  t.equal(generateId().length, 16, '~> has 16 characters (default)')
})

test('length', t => {
  const iterations = 1e3
  t.plan(iterations)

  let i = 0
  let tmp = ''
  for (; i < iterations; ++i) {
    tmp = generateId()
    t.equal(tmp.length, 16, `"${tmp}" is 16 characters`)
  }
})

test('unique /1', t => {
  t.plan(1)
  t.not(generateId(), generateId(), '~> single')
})

test('unique /2', t => {
  t.plan(1)
  const items = new Set()
  for (let i = 5e6; i--;) items.add(generateId())
  t.equal(items.size, 5e6, '~> 5,000,000 unique ids')
})

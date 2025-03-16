'use strict'

const test = require('node:test')
const { Readable } = require('node:stream')
const streamToNull = require('../lib/stream-consumer')

test('does what it should', async t => {
  t.plan(1)
  let count = 1_000_000
  const stream = new Readable({
    read () {
      if (count === 0) {
        this.push(null)
        return
      }
      count -= 1
      this.push(Buffer.from('1'))
    }
  })

  await streamToNull(stream)
  t.assert.ok(true)
})

test('handles close event', async t => {
  t.plan(1)
  let count = 1_000_000
  const stream = new Readable({
    read () {
      if (count === 50_000) {
        this.destroy()
        return
      }
      count -= 1
      this.push(Buffer.from('1'))
    }
  })

  await streamToNull(stream)
  t.assert.ok(true)
})

test('handles error event', async t => {
  t.plan(1)
  let count = 1_000_000
  const stream = new Readable({
    read () {
      if (count === 50_000) {
        this.destroy(Error('boom'))
        return
      }
      count -= 1
      this.push(Buffer.from('1'))
    }
  })

  try {
    await streamToNull(stream)
  } catch (error) {
    t.assert.match(error.toString(), /boom/)
  }
})

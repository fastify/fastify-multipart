'use strict'

const tap = require('tap')
const { Readable } = require('node:stream')
const streamToNull = require('../lib/stream-consumer')

tap.test('does what it should', async t => {
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
  t.pass()
})

tap.test('handles close event', async t => {
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
  t.pass()
})

tap.test('handles error event', async t => {
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
    t.match(error, /boom/)
  }
})

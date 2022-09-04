'use strict'

const http = require('http')
const Readable = require('stream').Readable
const FormData = require('form-data')
const pump = require('stream').pipeline
const knownLength = 1024 * 1024 * 1024

function next () {
  let total = knownLength
  const form = new FormData({ maxDataSize: total })
  const rs = new Readable({
    read (n) {
      if (n > total) {
        n = total
      }

      // poor man random data
      // do not use in prod, it can leak sensitive informations
      const buf = Buffer.allocUnsafe(n)
      this.push(buf)

      total -= n

      if (total === 0) {
        this.push(null)
      }
    }
  })

  form.append('my_field', 'my value')
  form.append('upload', rs, {
    filename: 'random-data',
    contentType: 'binary/octet-stream',
    knownLength
  })

  const opts = {
    protocol: 'http:',
    hostname: 'localhost',
    port: 3000,
    path: '/upload',
    headers: form.getHeaders(),
    method: 'POST'
  }

  const req = http.request(opts, next)

  pump(form, req)
}

next()

'use strict'
const util = require('util')
const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('http')
const path = require('path')
const fs = require('fs')
const concat = require('concat-stream')
const stream = require('stream')
const pump = util.promisify(stream.pipeline)

const filePath = path.join(__dirname, '../README.md')

test('should parse forms', function (t) {
  t.plan(8)

  const fastify = Fastify()
  t.tearDown(fastify.close.bind(fastify))

  fastify.register(multipart, { limits: { fields: 3 } })

  fastify.post('/', async function (req, reply) {
    for await (const part of req.multipart()) {
      if (part.file) {
        t.equal(part.fieldname, 'upload')
        t.equal(part.filename, 'README.md')
        t.equal(part.encoding, '7bit')
        t.equal(part.mimetype, 'text/markdown')
        t.ok(part.fields.upload)

        const original = fs.readFileSync(filePath, 'utf8')
        await pump(
          part.file,
          concat(function (buf) {
            t.equal(buf.toString(), original)
          })
        )
      }
    }

    reply.code(200).send()
  })

  fastify.listen(0, async function () {
    // request
    var form = new FormData()
    var opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    var req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      // consume all data without processing
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    var rs = fs.createReadStream(filePath)
    form.append('upload', rs)
    form.append('hello', 'world')
    form.append('willbe', 'dropped')
    await pump(form, req)
  })
})

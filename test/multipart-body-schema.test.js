'use strict'

const test = require('tap').test
const FormData = require('form-data')
const Fastify = require('fastify')
const multipart = require('..')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')

const filePath = path.join(__dirname, '../README.md')

test('should be able to use JSON schema to validate request', function (t) {
  t.plan(7)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { attachFieldsToBody: true, sharedSchemaId: '#mySharedSchema' })

  const original = fs.readFileSync(filePath, 'utf8')

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['hello', 'upload'],
        properties: {
          hello: { $ref: '#mySharedSchema' },
          upload: { $ref: '#mySharedSchema' }
        }
      }
    }
  }, async function (req, reply) {
    t.ok(req.isMultipart())

    t.same(Object.keys(req.body), ['upload', 'hello'])

    const content = await req.body.upload.toBuffer()

    t.equal(content.toString(), original)
    t.equal(req.body.hello.type, 'field')
    t.equal(req.body.hello.value, 'world')

    reply.code(200).send()
  })

  fastify.listen({ port: 0 }, function () {
    // request
    const form = new FormData()
    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 200)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    form.append('upload', fs.createReadStream(filePath))
    form.append('hello', 'world')
    form.pipe(req)
  })
})

test('should throw because JSON schema is invalid', function (t) {
  t.plan(2)

  const fastify = Fastify()
  t.teardown(fastify.close.bind(fastify))

  fastify.register(multipart, { attachFieldsToBody: true, sharedSchemaId: '#mySharedSchema' })

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['hello'],
        properties: {
          hello: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                enum: ['red']
              }
            }
          }
        }
      }
    }
  }, async function (req, reply) {
    console.log(req.body)
    reply.code(200).send()
  })

  fastify.listen({ port: 0 }, function () {
    // request
    const form = new FormData()
    const opts = {
      protocol: 'http:',
      hostname: 'localhost',
      port: fastify.server.address().port,
      path: '/',
      headers: form.getHeaders(),
      method: 'POST'
    }

    const req = http.request(opts, (res) => {
      t.equal(res.statusCode, 400)
      res.resume()
      res.on('end', () => {
        t.pass('res ended successfully')
      })
    })
    form.append('hello', 'world')
    form.pipe(req)
  })
})

'use strict'

const fastify = require('fastify')()
const fs = require('node:fs')
const util = require('node:util')
const path = require('node:path')
const { pipeline } = require('node:stream')
const pump = util.promisify(pipeline)
const form = path.join(__dirname, '..', 'form.html')

fastify.register(require('..'))

fastify.get('/', function (req, reply) {
  reply.type('text/html').send(fs.createReadStream(form))
})

fastify.post('/upload/stream/single', async function (req, reply) {
  const data = await req.file()
  await pump(data.file, fs.createWriteStream(data.filename))
  reply.send()
})

fastify.post('/upload/stream/single-buf', async function (req, reply) {
  for await (const part of req.parts()) {
    if (part.file) {
      await part.toBuffer()
      console.log(part)
    }
  }
  reply.send()
})

fastify.post('/upload/stream/files', async function (req, reply) {
  const parts = req.files()
  for await (const part of parts) {
    await pump(part.file, fs.createWriteStream(part.filename))
  }
  reply.send()
})

fastify.post('/upload/raw/any', async function (req, reply) {
  const parts = req.parts()
  for await (const part of parts) {
    if (part.type === 'file') {
      await pump(part.file, fs.createWriteStream(part.filename))
    } else {
      // part.type === 'field'
      console.log(part)
    }
  }
  reply.send()
})

fastify.post('/upload/files', async function (req, reply) {
  // stores files to tmp dir and return paths
  const files = await req.saveRequestFiles()
  console.log(files.map(f => f.filepath))
  // tmp files cleaned up automatically
  reply.send()
})

fastify.listen({ port: 3000 }, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})

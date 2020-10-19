'use strict'

const fastify = require('fastify')()
const fs = require('fs')
const util = require('util')
const path = require('path')
const { pipeline } = require('stream')
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
  const parts = await req.files()
  for await (const part of parts) {
    await pump(part.file, fs.createWriteStream(part.filename))
  }
  reply.send()
})

fastify.post('/upload/raw/any', async function (req, reply) {
  const parts = await req.parts()
  for await (const part of parts) {
    if (part.file) {
      await pump(part.file, fs.createWriteStream(part.filename))
    } else {
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

fastify.listen(3000, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})

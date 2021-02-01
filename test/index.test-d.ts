import fastify from 'fastify'
import fastifyMultipart from '..'
import { Multipart, MultipartFields } from '..'
import * as util from 'util'
import { pipeline } from 'stream'
import * as fs from 'fs'
import { expectError, expectType } from 'tsd'

const pump = util.promisify(pipeline)

const runServer = async () => {
  const app = fastify()

  app.register(fastifyMultipart, {
    addToBody: true,
    sharedSchemaId: 'sharedId',
    throwFileSizeLimit: false,
    // stream should be of type streams.Readable
    // body should be of type fastifyMulipart.Record<string, BodyEntry>
    onFile: (fieldName: string, stream: any, filename: string, encoding: string, mimetype: string, body: Record<string, any>) => {
      console.log(fieldName, stream, filename, encoding, mimetype, body)
    },
    limits: {
      fieldNameSize: 200,
      fieldSize: 200,
      fields: 200,
      fileSize: 200,
      files: 2,
      headerPairs: 200
    }
  })

  app.get('/path', (request) => {
    const isMultiPart = request.isMultipart()
    request.multipart((field, file, filename, encoding, mimetype) => {
      console.log(field, file, filename, encoding, mimetype, isMultiPart)
    }, (err) => {
      throw err
    }, {
      limits: {
        fileSize: 10000
      }
    })
  })

  // usage
  app.post('/', async (req, reply) => {
    const data = await req.file()

    expectType<NodeJS.ReadableStream>(data.file)
    expectType<MultipartFields>(data.fields)
    expectType<string>(data.fieldname)
    expectType<string>(data.filename)
    expectType<string>(data.encoding)
    expectType<string>(data.mimetype)

    await pump(data.file, fs.createWriteStream(data.filename))

    reply.send()
  })

  // Multiple fields including scalar values
  app.post<{Body: {file: Multipart, foo: Multipart<string>}}>('/upload/stringvalue', async (req, reply) => {
    expectError(req.body.foo.file);
    expectType<string>(req.body.foo.value);

    expectType<NodeJS.ReadableStream>(req.body.file.file)
    expectError(req.body.file.value);
    reply.send();
  })

  app.post<{Body: {file: Multipart, num: Multipart<number>}}>('/upload/stringvalue', async (req, reply) => {
    expectType<number>(req.body.num.value);
    reply.send();

    // file is a file
    expectType<NodeJS.ReadableStream>(req.body.file.file)
    expectError(req.body.file.value);
  })

  // busboy
  app.post('/', async function (req, reply) {
    const options: busboy.BusboyConfig = { limits: { fileSize: 1000 } };
    const data = await req.file(options)
    await pump(data.file, fs.createWriteStream(data.filename))
    reply.send()
  })

  // handle multiple file streams
  app.post('/', async (req, reply) => {
    const parts = await req.files()
    for await (const part of parts) {
      await pump(part.file, fs.createWriteStream(part.filename))
    }
    reply.send()
  })

  // handle multiple file streams and fields
  app.post('/upload/raw/any', async function (req, reply) {
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

  // accumulate whole file in memory
  app.post('/upload/raw/any', async function (req, reply) {
    const data = await req.file()
    const buffer = await data.toBuffer()
    // upload to S3
    reply.send()
  })

  // upload files to disk and work with temporary file paths
  app.post('/upload/files', async function (req, reply) {
    // stores files to tmp dir and return files
    const files = await req.saveRequestFiles()
    files[0].filepath
    files[0].fieldname
    files[0].filename
    files[0].encoding
    files[0].mimetype
    files[0].fields // other parsed parts

    reply.send()
  })

  // access all errors
  app.post('/upload/files', async function (req, reply) {
    const { FilesLimitError } = app.multipartErrors
  })

  await app.ready()
}

runServer().then(
  console.log.bind(console, 'Success'),
  console.error.bind(console, 'Error')
)

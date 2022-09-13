import fastify from 'fastify'
import fastifyMultipart, {MultipartValue, MultipartFields, MultipartFile } from '..'
import * as util from 'util'
import { pipeline } from 'stream'
import * as fs from 'fs'
import { expectError, expectType } from 'tsd'
import { FastifyErrorConstructor } from "@fastify/error"
import { BusboyConfig, BusboyFileStream } from "@fastify/busboy";

const pump = util.promisify(pipeline)

const runServer = async () => {
  const app = fastify()

  app.register(fastifyMultipart, {
    addToBody: true,
    sharedSchemaId: 'sharedId',
    throwFileSizeLimit: false,
    // stream should be of type streams.Readable
    // body should be of type fastifyMultipart.Record<string, BodyEntry>
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

  app.register(fastifyMultipart, {
    attachFieldsToBody: true,
    onFile: (part: MultipartFile) => {
      console.log(part)
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
    if (data == null) throw new Error('missing file')

    expectType<BusboyFileStream>(data.file)
    expectType<boolean>(data.file.truncated)
    expectType<MultipartFields>(data.fields)
    expectType<string>(data.fieldname)
    expectType<string>(data.filename)
    expectType<string>(data.encoding)
    expectType<string>(data.mimetype)

    await pump(data.file, fs.createWriteStream(data.filename))

    reply.send()
  })

  // Multiple fields including scalar values
  app.post<{Body: {file: MultipartFile, foo: MultipartValue<string>}}>('/upload/stringvalue', async (req, reply) => {
    expectError(req.body.foo.file);
    expectType<string>(req.body.foo.value);

    expectType<BusboyFileStream>(req.body.file.file)
    expectError(req.body.file.value);
    reply.send();
  })

  app.post<{Body: {file: MultipartFile, num: MultipartValue<number>}}>('/upload/stringvalue', async (req, reply) => {
    expectType<number>(req.body.num.value);
    reply.send();

    // file is a file
    expectType<BusboyFileStream>(req.body.file.file)
    expectError(req.body.file.value);
  })

  // busboy
  app.post('/', async function (req, reply) {
    const options: Partial<BusboyConfig> = { limits: { fileSize: 1000 } };
    const data = await req.file(options)
    if (!data) throw new Error('missing file')
    await pump(data.file, fs.createWriteStream(data.filename))
    reply.send()
  })

  // handle multiple file streams
  app.post('/', async (req, reply) => {
    const parts = req.files()
    for await (const part of parts) {
      await pump(part.file, fs.createWriteStream(part.filename))
    }
    reply.send()
  })

  // handle multiple file streams and fields
  app.post('/upload/raw/any', async function (req, reply) {
    const parts = req.parts()
    for await (const part of parts) {
      if ('file' in part) {
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
    if (!data) throw new Error('missing file')
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

  // upload files to disk with busboy options
  app.post('/upload/files', async function (req, reply) {
    const options: Partial<BusboyConfig> = { limits: { fileSize: 1000 } };
    await req.saveRequestFiles(options)

    reply.send()
  })

  // access all errors
  app.post('/upload/files', async function (req, reply) {
    const { FilesLimitError } = app.multipartErrors

    expectType<FastifyErrorConstructor>(app.multipartErrors.FieldsLimitError);
    expectType<FastifyErrorConstructor>(app.multipartErrors.FilesLimitError);
    expectType<FastifyErrorConstructor>(app.multipartErrors.InvalidMultipartContentTypeError);
    expectType<FastifyErrorConstructor>(app.multipartErrors.PartsLimitError);
    expectType<FastifyErrorConstructor>(app.multipartErrors.PrototypeViolationError);
    expectType<FastifyErrorConstructor>(app.multipartErrors.RequestFileTooLargeError);

    // test instanceof Error
    const a = new FilesLimitError();
    if (a instanceof FilesLimitError) {
      console.log("FilesLimitError occurred.");
    }

    reply.send();
  })

  await app.ready()
}

runServer().then(
  console.log.bind(console, 'Success'),
  console.error.bind(console, 'Error')
)

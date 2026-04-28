/* eslint-disable @typescript-eslint/no-unused-expressions */
import fastify from 'fastify'
import fastifyMultipart, { MultipartValue, MultipartFields, MultipartFile } from '.'
import * as util from 'node:util'
import { pipeline } from 'node:stream'
import * as fs from 'node:fs'
import { expect } from 'tstyche'
import { FastifyErrorConstructor } from '@fastify/error'
import { BusboyConfig, BusboyFileStream } from '@fastify/busboy'

const pump = util.promisify(pipeline)

const runServer = async () => {
  const app = fastify()

  app.register(fastifyMultipart, {
    preservePath: true, // field inherited from `BusboyConfig` interface
    attachFieldsToBody: true,
    limits: {
      parts: 500
    },
    onFile: (part: MultipartFile) => {
      console.log(part)
    }
  })

  // usage
  app.post('/', async (req, reply) => {
    expect(req.formData()).type.toBe<Promise<FormData>>()
    const data = await req.file()
    if (data == null) throw new Error('missing file')

    expect(data.type).type.toBe<'file'>()
    expect(data.file).type.toBe<BusboyFileStream>()
    expect(data.file.truncated).type.toBe<boolean>()
    expect(data.fields).type.toBe<MultipartFields>()
    expect(data.fieldname).type.toBe<string>()
    expect(data.filename).type.toBe<string>()
    expect(data.encoding).type.toBe<string>()
    expect(data.mimetype).type.toBe<string>()

    const field = data.fields.myField
    if (field === undefined) {
      // field missing from the request
    } else if (Array.isArray(field)) {
      // multiple fields with the same name
    } else if (field.type === 'file') {
      // field containing a file
      field.file.resume()
    } else {
      // field containing a value
      field.fields.value
    }

    await pump(data.file, fs.createWriteStream(data.filename))

    reply.send()
  })

  // Multiple fields including scalar values
  app.post<{ Body: { file: MultipartFile, foo: MultipartValue<string> } }>('/upload/stringvalue', async (req, reply) => {
    expect(req.body.foo).type.not.toHaveProperty('file')
    expect(req.body.foo.type).type.toBe<'field'>()
    expect(req.body.foo.value).type.toBe<string>()

    expect(req.body.file.file).type.toBe<BusboyFileStream>()
    expect(req.body.file.type).type.toBe<'file'>()
    reply.send()
  })

  app.post<{ Body: { file: MultipartFile, num: MultipartValue<number> } }>('/upload/stringvalue', async (req, reply) => {
    expect(req.body.num.value).type.toBe<number>()
    reply.send()

    expect(req.body.file.file).type.toBe<BusboyFileStream>()
    expect(req.body.file).type.not.toHaveProperty('value')
  })

  // busboy
  app.post('/', async function (req, reply) {
    const data = await req.file({
      limits: { fileSize: 1000, parts: 500 },
      throwFileSizeLimit: true,
      sharedSchemaId: 'schemaId',
      isPartAFile: (fieldName, contentType, fileName) => {
        expect(fieldName).type.toBe<string | undefined>()
        expect(contentType).type.toBe<string | undefined>()
        expect(fileName).type.toBe<string | undefined>()
        return true
      }
    })
    if (!data) throw new Error('missing file')
    await pump(data.file, fs.createWriteStream(data.filename))
    reply.send()
  })

  // handle multiple file streams
  app.post('/', async (req, reply) => {
    const parts = req.files({
      limits: { fileSize: 1000, parts: 500 },
      throwFileSizeLimit: true,
      sharedSchemaId: 'schemaId',
      isPartAFile: (fieldName, contentType, fileName) => {
        expect(fieldName).type.toBe<string | undefined>()
        expect(contentType).type.toBe<string | undefined>()
        expect(fileName).type.toBe<string | undefined>()
        return true
      }
    })
    for await (const part of parts) {
      await pump(part.file, fs.createWriteStream(part.filename))
    }
    reply.send()
  })

  // handle multiple file streams and fields
  app.post('/upload/raw/any', async function (req, reply) {
    const parts = req.parts()
    for await (const part of parts) {
      if (part.type === 'file') {
        await pump(part.file, fs.createWriteStream(part.filename))
      } else {
        console.log(part.value)
      }
    }
    reply.send()
  })

  // accumulate whole file in memory
  app.post('/upload/raw/any', async function (req, reply) {
    const data = await req.file()
    if (!data) throw new Error('missing file')
    expect(await data.toBuffer()).type.toBe<Buffer>()
    // upload to S3
    reply.send()
  })

  // upload files to disk and work with temporary file paths
  app.post('/upload/files', async function (req, reply) {
    // stores files to tmp dir and return files + values
    const { files, values } = await req.saveRequestFiles()
    files[0]!.type // "file"
    files[0]!.filepath
    files[0]!.fieldname
    files[0]!.filename
    files[0]!.encoding
    files[0]!.mimetype
    files[0]!.fields // other parsed parts
    values.foo

    reply.send()
  })

  // upload files to disk with busboy options
  app.post('/upload/files', async function (req, reply) {
    const options: Partial<BusboyConfig> = { limits: { fileSize: 1000 } }
    await req.saveRequestFiles(options)

    reply.send()
  })

  // access all errors
  app.post('/upload/files', async function (_req, reply) {
    const { FilesLimitError } = app.multipartErrors

    expect(app.multipartErrors.FieldsLimitError).type.toBe<FastifyErrorConstructor>()
    expect(app.multipartErrors.FilesLimitError).type.toBe<FastifyErrorConstructor>()
    expect(app.multipartErrors.InvalidMultipartContentTypeError).type.toBe<FastifyErrorConstructor>()
    expect(app.multipartErrors.PartsLimitError).type.toBe<FastifyErrorConstructor>()
    expect(app.multipartErrors.PrototypeViolationError).type.toBe<FastifyErrorConstructor>()
    expect(app.multipartErrors.RequestFileTooLargeError).type.toBe<FastifyErrorConstructor>()

    // test instanceof Error
    const a = new FilesLimitError()
    if (a instanceof FilesLimitError) {
      console.log('FilesLimitError occurred.')
    }

    reply.send()
  })

  app.post('/upload/files', {
    config: {
      multipartOptions: {}
    }
  }, async function (req, reply) {
    expect(req.routeOptions.config.multipartOptions).type.toBe<Omit<BusboyConfig, 'headers'>>()
    reply.send()
  })

  app.post('/upload/files', async function (req, reply) {
    expect(req.routeOptions.config.multipartOptions).type.toBe<Omit<BusboyConfig, 'headers'> | undefined>()
    reply.send()
  })

  await app.ready()
}

runServer().then(
  console.log.bind(console, 'Success'),
  console.error.bind(console, 'Error')
)

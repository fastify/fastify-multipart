# @fastify/multipart

![CI](https://github.com/fastify/fastify-multipart/workflows/CI/badge.svg)
[![NPM version](https://img.shields.io/npm/v/@fastify/multipart.svg?style=flat)](https://www.npmjs.com/package/@fastify/multipart)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://standardjs.com/)

Fastify plugin to parse the multipart content-type. Supports:

- Async / Await
- Async iterator support to handle multiple parts
- Stream & Disk mode
- Accumulate whole file in memory
- Mode to attach all fields to the request body
- Tested across Linux/Mac/Windows

Under the hood it uses [`@fastify/busboy`](https://github.com/fastify/busboy).

## Install
```sh
npm i --save @fastify/multipart
```

## Usage

If you are looking for the documentation for the legacy callback-api please see [here](./callback.md).

```js
const fastify = require('fastify')()
const fs = require('fs')
const util = require('util')
const path = require('path')
const { pipeline } = require('stream')
const pump = util.promisify(pipeline)

fastify.register(require('@fastify/multipart'))

fastify.post('/', async function (req, reply) {
  // process a single file
  // also, consider that if you allow to upload multiple files
  // you must consume all files otherwise the promise will never fulfill
  const data = await req.file()

  data.file // stream
  data.fields // other parsed parts
  data.fieldname
  data.filename
  data.encoding
  data.mimetype

  // to accumulate the file in memory! Be careful!
  //
  // await data.toBuffer() // Buffer
  //
  // or

  await pump(data.file, fs.createWriteStream(data.filename))

  // be careful of permission issues on disk and not overwrite
  // sensitive files that could cause security risks
  
  // also, consider that if the file stream is not consumed, the promise will never fulfill

  reply.send()
})

fastify.listen(3000, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
```

**Note** about `data.fields`: `busboy` consumes the multipart in serial order (stream). Therefore, the order of form fields is *VERY IMPORTANT* to how `@fastify/multipart` can display the fields to you.
We would recommend you place the value fields first before any of the file fields.
It will ensure your fields are accessible before it starts consuming any files.
If you cannot control the order of the placed fields, be sure to read `data.fields` *AFTER* consuming the stream, or it will only contain the fields parsed at that moment.

You can also pass optional arguments to `@fastify/busboy` when registering with Fastify. This is useful for setting limits on the content that can be uploaded. A full list of available options can be found in the [`@fastify/busboy` documentation](https://github.com/fastify/busboy#busboy-methods).

```js
fastify.register(require('@fastify/multipart'), {
  limits: {
    fieldNameSize: 100, // Max field name size in bytes
    fieldSize: 100,     // Max field value size in bytes
    fields: 10,         // Max number of non-file fields
    fileSize: 1000000,  // For multipart forms, the max file size in bytes
    files: 1,           // Max number of file fields
    headerPairs: 2000   // Max number of header key=>value pairs
  }
});
```

**Note**: if the file stream that is provided by `data.file` is not consumed, like in the example below with the usage of pump, the promise will not be fulfilled at the end of the multipart processing.
This behavior is inherited from [`@fastify/busboy`](https://github.com/fastify/busboy).

**Note**: if you set a `fileSize` limit and you want to know if the file limit was reached you can:
- listen to `data.file.on('limit')`
- or check at the end of the stream the property `data.file.truncated`
- or call `data.file.toBuffer()` and wait for the error to be thrown

```js
const data = await req.file()
await pump(data.file, fs.createWriteStream(data.filename))
if (data.file.truncated) {
  // you may need to delete the part of the file that has been saved on disk
  // before the `limits.fileSize` has been reached
  reply.send(new fastify.multipartErrors.FilesLimitError());    
}

// OR
const data = await req.file()
try {
  const buffer = await data.toBuffer()
} catch (err) {
  // fileSize limit reached!
}

``` 

Additionally, you can pass per-request options to the  `req.file`, `req.files`, `req.saveRequestFiles` or `req.parts` function.

```js
fastify.post('/', async function (req, reply) {
  const options = { limits: { fileSize: 1000 } };
  const data = await req.file(options)
  await pump(data.file, fs.createWriteStream(data.filename))
  reply.send()
})
```

## Handle multiple file streams

```js
fastify.post('/', async function (req, reply) {
  const parts = req.files()
  for await (const part of parts) {
    await pump(part.file, fs.createWriteStream(part.filename))
  }
  reply.send()
})
```

## Handle multiple file streams and fields

```js
fastify.post('/upload/raw/any', async function (req, reply) {
  const parts = req.parts()
  for await (const part of parts) {
    if (part.file) {
      await pump(part.file, fs.createWriteStream(part.filename))
    } else {
      console.log(part)
    }
  }
  reply.send()
})
```

## Accumulate whole file in memory

```js
fastify.post('/upload/raw/any', async function (req, reply) {
  const data = await req.file()
  const buffer = await data.toBuffer()
  // upload to S3
  reply.send()
})
```


## Upload files to disk and work with temporary file paths

This will store all files in the operating system default directory for temporary files. As soon as the response ends all files are removed.

```js
fastify.post('/upload/files', async function (req, reply) {
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
```

## Handle file size limitation

If you set a `fileSize` limit, it is able to throw a `RequestFileTooLargeError` error when limit reached.

```js
fastify.post('/upload/files', async function (req, reply) {
  try {
    const file = await req.file({ limits: { fileSize: 17000 } })
    //const files = req.files({ limits: { fileSize: 17000 } })
    //const parts = req.parts({ limits: { fileSize: 17000 } })
    //const files = await req.saveRequestFiles({ limits: { fileSize: 17000 } })
    reply.send()
  } catch (error) {
    // error instanceof fastify.multipartErrors.RequestFileTooLargeError
  }
})
```

If you want to fallback to the handling before `4.0.0`, you can disable the throwing behavior by passing `throwFileSizeLimit`.
Note: It will not affect the behavior of `saveRequestFiles()`

```js
// globally disable
fastify.register(fastifyMultipart, { throwFileSizeLimit: false })

fastify.post('/upload/file', async function (req, reply) {
  const file = await req.file({ throwFileSizeLimit: false, limits: { fileSize: 17000 } })
  //const files = req.files({ throwFileSizeLimit: false, limits: { fileSize: 17000 } })
  //const parts = req.parts({ throwFileSizeLimit: false, limits: { fileSize: 17000 } })
  //const files = await req.saveRequestFiles({ throwFileSizeLimit: false, limits: { fileSize: 17000 } })
  reply.send()
})
```

## Parse all fields and assign them to the body

This allows you to parse all fields automatically and assign them to the `request.body`. By default files are accumulated in memory (Be careful!) to buffer objects. Uncaught errors are [handled](https://github.com/fastify/fastify/blob/master/docs/Hooks.md#manage-errors-from-a-hook) by Fastify.

```js
fastify.register(require('@fastify/multipart'), { attachFieldsToBody: true })

fastify.post('/upload/files', async function (req, reply) {
  const uploadValue = await req.body.upload.toBuffer() // access files
  const fooValue = req.body.foo.value                  // other fields
  const body = Object.fromEntries(
    Object.keys(req.body).map((key) => [key, req.body[key].value])
  ) // Request body in key-value pairs, like req.body in Express (Node 12+)
})
```

You can also define an `onFile` handler to avoid accumulating all files in memory.

```js
async function onFile(part) {
  await pump(part.file, fs.createWriteStream(part.filename))
}

fastify.register(require('@fastify/multipart'), { attachFieldsToBody: true, onFile })

fastify.post('/upload/files', async function (req, reply) {
  const fooValue = req.body.foo.value // other fields
})
```

**Note**: if you assign all fields to the body and don't define an `onFile` handler, you won't be able to read the files through streams, as they are already read and their contents are accumulated in memory.
You can only use the `toBuffer` method to read the content.
If you try to read from a stream and pipe to a new file, you will obtain an empty new file.

## JSON Schema body validation

If you enable `attachFieldsToBody` and set `sharedSchemaId` a shared JSON Schema is added, which can be used to validate parsed multipart fields.

```js
const opts = {
  attachFieldsToBody: true,
  sharedSchemaId: '#mySharedSchema'
}
fastify.register(require('@fastify/multipart'), opts)

fastify.post('/upload/files', {
  schema: {
    body: {
      type: 'object',
      required: ['myField'],
      properties: {
        // field that uses the shared schema
        myField: { $ref: '#mySharedSchema'},
        // or another field that uses the shared schema
        myFiles: { type: 'array', items: fastify.getSchema('mySharedSchema') },
        // or a field that doesn't use the shared schema
        hello: {
          properties: {
            value: { 
              type: 'string',
              enum: ['male']
            }
          }
        }
      }
    }
  }
}, function (req, reply) {
  console.log({ body: req.body })
  reply.send('done')
})
```

If provided, the `sharedSchemaId` parameter must be a string ID and a shared schema will be added to your fastify instance so you will be able to apply the validation to your service (like in the example mentioned above).

The shared schema, that is added, will look like this:
```js
{
  type: 'object',
  properties: {
    encoding: { type: 'string' },
    filename: { type: 'string' },
    limit: { type: 'boolean' },
    mimetype: { type: 'string' }
  }
}
```

### JSON Schema non-file field
When sending fields with the body (`attachFieldsToBody` set to true), the field might look like this in the `request.body`:
```json
{
  "hello": "world"
}
```
The mentioned field will be converted, by this plugin, to a more complex field. The converted field will look something like this:
```js
{ 
  hello: {
    fieldname: "hello",
    value: "world",
    fieldnameTruncated: false,
    valueTruncated: false,
    fields: body
  }
}
```

It is important to know that this conversion happens BEFORE the field is validated, so keep that in mind when writing the JSON schema for validation for fields that don't use the shared schema. The schema for validation for the field mentioned above should look like this:
```js
hello: {
  properties: {
    value: { 
      type: 'string'
    }
  }
}
```

#### JSON non-file fields

If a non file field sent has `Content-Type` header starting with `application/json`, it will be parsed using `JSON.parse`. 

The schema to validate JSON fields should look like this:

```js
hello: {
  properties: {
    value: { 
      type: 'object',
      properties: {
        /* ... */
      }
    }
  }
}
```

If you also use the shared JSON schema as shown above, this is a full example which validates the entire field:

```js
const opts = {
  attachFieldsToBody: true,
  sharedSchemaId: '#mySharedSchema'
}
fastify.register(require('@fastify/multipart'), opts)

fastify.post('/upload/files', {
  schema: {
    body: {
      type: 'object',
      required: ['field'],
      properties: {
        field: {
          allOf: [
            { $ref: '#mySharedSchema' }, 
            { 
              properties: { 
                value: { 
                  type: 'object'
                  properties: {
                    child: {
                      type: 'string'
                    }
                  }
                }
              }
            }
          ]
        }
      }
    }
  }
}, function (req, reply) {
  console.log({ body: req.body })
  reply.send('done')
})
```

## Access all errors

We export all custom errors via a server decorator `fastify.multipartErrors`. This is useful if you want to react to specific errors. They are derived from [@fastify/error](https://github.com/fastify/fastify-error) and include the correct `statusCode` property.

```js
fastify.post('/upload/files', async function (req, reply) {
  const { FilesLimitError } = fastify.multipartErrors
})
```

## Acknowledgements

This project is kindly sponsored by:
- [nearForm](https://nearform.com)
- [LetzDoIt](https://www.letzdoitapp.com/)

## License

Licensed under [MIT](./LICENSE).

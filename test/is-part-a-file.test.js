'use strict'

const test = require('node:test')
const Fastify = require('fastify')
const multipart = require('..')

test('isPartAFile handling for parts without filename (issue #504)', async (t) => {
  await t.test('default behavior treats parts without filename and with non-octet-stream as fields', async (t) => {
    t.plan(2)
    const app = Fastify()
    await app.register(multipart)

    app.post('/upload', async (req) => {
      const file = await req.file()
      return { file: file ? { fieldname: file.fieldname, filename: file.filename, mimetype: file.mimetype } : null }
    })

    await app.ready()

    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="upload"',
      'Content-Type: text/plain',
      '',
      'plain text file content',
      `--${boundary}--`
    ].join('\r\n')

    const res = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body
    })

    t.assert.strictEqual(res.statusCode, 200)
    t.assert.deepStrictEqual(JSON.parse(res.body), { file: null })
  })

  await t.test('global isPartAFile option allows detecting files without filename', async (t) => {
    t.plan(4)
    const app = Fastify()
    await app.register(multipart, {
      isPartAFile: (fieldName, contentType, fileName) => {
        return fileName !== undefined || contentType === 'text/plain'
      }
    })

    app.post('/upload', async (req) => {
      const file = await req.file()
      const content = file ? (await file.toBuffer()).toString() : null
      return {
        file: file ? { fieldname: file.fieldname, filename: file.filename, mimetype: file.mimetype, content } : null
      }
    })

    await app.ready()

    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="upload"',
      'Content-Type: text/plain',
      '',
      'plain text file content',
      `--${boundary}--`
    ].join('\r\n')

    const res = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body
    })

    t.assert.strictEqual(res.statusCode, 200)
    const json = JSON.parse(res.body)
    t.assert.strictEqual(json.file.fieldname, 'upload')
    t.assert.strictEqual(json.file.mimetype, 'text/plain')
    t.assert.strictEqual(json.file.content, 'plain text file content')
  })

  await t.test('per-request isPartAFile option in req.file()', async (t) => {
    t.plan(3)
    const app = Fastify()
    await app.register(multipart)

    app.post('/upload', async (req) => {
      const file = await req.file({
        isPartAFile: (fieldName, contentType, fileName) => {
          return fileName !== undefined || Boolean(contentType)
        }
      })
      const content = file ? (await file.toBuffer()).toString() : null
      return {
        file: file ? { fieldname: file.fieldname, mimetype: file.mimetype, content } : null
      }
    })

    await app.ready()

    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="attachment"',
      'Content-Type: application/json',
      '',
      '{"hello":"world"}',
      `--${boundary}--`
    ].join('\r\n')

    const res = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body
    })

    t.assert.strictEqual(res.statusCode, 200)
    const json = JSON.parse(res.body)
    t.assert.strictEqual(json.file.fieldname, 'attachment')
    t.assert.strictEqual(json.file.content, '{"hello":"world"}')
  })

  await t.test('per-request isPartAFile option in req.files()', async (t) => {
    t.plan(3)
    const app = Fastify()
    await app.register(multipart)

    app.post('/upload', async (req) => {
      const files = []
      for await (const part of req.files({
        isPartAFile: (fieldName, contentType, fileName) => Boolean(contentType)
      })) {
        const content = (await part.toBuffer()).toString()
        files.push({ fieldname: part.fieldname, content })
      }
      return { files }
    })

    await app.ready()

    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="fileA"',
      'Content-Type: text/csv',
      '',
      'a,b,c',
      `--${boundary}`,
      'Content-Disposition: form-data; name="fileB"',
      'Content-Type: text/csv',
      '',
      '1,2,3',
      `--${boundary}--`
    ].join('\r\n')

    const res = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body
    })

    t.assert.strictEqual(res.statusCode, 200)
    const json = JSON.parse(res.body)
    t.assert.strictEqual(json.files.length, 2)
    t.assert.deepStrictEqual(json.files, [
      { fieldname: 'fileA', content: 'a,b,c' },
      { fieldname: 'fileB', content: '1,2,3' }
    ])
  })

  await t.test('per-request isPartAFile option in req.parts()', async (t) => {
    t.plan(3)
    const app = Fastify()
    await app.register(multipart)

    app.post('/upload', async (req) => {
      const parts = []
      for await (const part of req.parts({
        isPartAFile: (fieldName, contentType, fileName) => contentType === 'application/pdf'
      })) {
        if (part.file) {
          const content = (await part.toBuffer()).toString()
          parts.push({ type: 'file', fieldname: part.fieldname, content })
        } else {
          parts.push({ type: 'field', fieldname: part.fieldname, value: part.value })
        }
      }
      return { parts }
    })

    await app.ready()

    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="doc"',
      'Content-Type: application/pdf',
      '',
      '%PDF-1.4 file content',
      `--${boundary}`,
      'Content-Disposition: form-data; name="title"',
      '',
      'My Document',
      `--${boundary}--`
    ].join('\r\n')

    const res = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body
    })

    t.assert.strictEqual(res.statusCode, 200)
    const json = JSON.parse(res.body)
    t.assert.strictEqual(json.parts.length, 2)
    t.assert.deepStrictEqual(json.parts, [
      { type: 'file', fieldname: 'doc', content: '%PDF-1.4 file content' },
      { type: 'field', fieldname: 'title', value: 'My Document' }
    ])
  })
})

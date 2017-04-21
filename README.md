# fastify-multipart

[![Greenkeeper badge](https://badges.greenkeeper.io/fastify/fastify-multipart.svg)](https://greenkeeper.io/)

[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](http://standardjs.com/)  [![Build Status](https://travis-ci.org/fastify/fastify-multipart.svg?branch=master)](https://travis-ci.org/fastify/fastify-multipart)

Fastify plugin to parse the multipart content-type.

Under the hood it uses [multipart-read-stream](https://github.com/yoshuawuyts/multipart-read-stream).

## Install
```
npm i fastify-multipart --save
```
## Usage

```js
const fastify = require('fastify')
const concat = require('concat-stream')

fastify.register(require('fastify-multipart'), err => {
  if (err) throw err
})

fastify.post('/', function (req, reply) {
  req.multipart(handler, function (err) {
    console.log('upload completed')
    reply.code(200).send()
  })

  function handler (field, file, filename, encoding, mimetype) {
    file.pipe(concat(function (buf) {
      console.log('received', filename, 'size', buf.length)
    }))
  }
})

fastify.listen(3000, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
```

## Acknowledgements

This project is kindly sponsored by:
- [nearForm](http://nearform.com)
- [LetzDoIt](http://www.letzdoitapp.com/)

## License

Licensed under [MIT](./LICENSE).

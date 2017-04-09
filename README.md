# fastify-multipart

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

fastify.register(require('fastify-multipart'), err => {
  if (err) throw err
})

fastify.get('/user/:id', (req, reply) => {
  const { db } = fastify.mongo
  db.collection('users', onCollection)

  function onCollection (err, col) {
    if (err) return reply.send(err)

    col.findOne({ id: req.params.id }, (err, user) => {
      reply.send(user)
    })
  })
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

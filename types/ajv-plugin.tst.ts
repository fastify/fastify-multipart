import fastify from 'fastify'
import type Ajv from 'ajv'
import { expect } from 'tstyche'
import { fastifyMultipart, ajvFilePlugin } from '..'

// ajvFilePlugin must be compatible with Fastify's ajv.plugins option
const app = fastify({
  ajv: {
    plugins: [ajvFilePlugin]
  }
})

app.register(fastifyMultipart)

// ajvFilePlugin must accept an Ajv instance and return it
declare const ajv: Ajv
expect(ajvFilePlugin(ajv)).type.toBe<Ajv>()

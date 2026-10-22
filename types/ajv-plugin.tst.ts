import fastify from 'fastify'
import type Ajv from 'ajv'
import { expect } from 'tstyche'
import * as fastifyMultipart from '..'
import { ajvFilePlugin } from '..'

expect(ajvFilePlugin).type.toBeAssignableTo<Function>()
expect(fastifyMultipart.ajvFilePlugin).type.toBe(ajvFilePlugin)

// ajvFilePlugin must be compatible with Fastify's ajv.plugins option
const app = fastify({
  ajv: {
    plugins: [ajvFilePlugin]
  }
})

app.register(fastifyMultipart.fastifyMultipart)

// ajvFilePlugin must accept an Ajv instance and return it
declare const ajv: Ajv
expect(ajvFilePlugin(ajv)).type.toBe<Ajv>()

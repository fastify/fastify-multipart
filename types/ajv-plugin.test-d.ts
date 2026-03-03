import fastify from 'fastify'
import { expectType } from 'tsd'
import type Ajv from 'ajv'
import { fastifyMultipart, ajvFilePlugin } from '..'

// Test: ajvFilePlugin should be compatible with Fastify's ajv.plugins option
const app = fastify({
  ajv: {
    plugins: [
      ajvFilePlugin,
      (await import('../..')).ajvFilePlugin
    ]
  }
})

app.register(fastifyMultipart)

// Test: ajvFilePlugin should accept Ajv and return Ajv
declare const ajv: Ajv
expectType<Ajv>(ajvFilePlugin(ajv))

import fastify from 'fastify'
import { fastifyMultipart, ajvFilePlugin } from '..'

const app = fastify({
  ajv: {
    plugins: [
      ajvFilePlugin,
      (await import('..')).ajvFilePlugin
    ]
  }
})

app.register(fastifyMultipart)

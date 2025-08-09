import fastifyMultipart, { type MultipartFile } from '@fastify/multipart'
import fastify from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { z } from 'zod'

const app = fastify().withTypeProvider<ZodTypeProvider>()

app.setSerializerCompiler(serializerCompiler)
app.setValidatorCompiler(validatorCompiler)

// `attachFieldsToBody` parameter needs to be `true`
app.register(fastifyMultipart, { attachFieldsToBody: true })

app.post(
  '/upload',
  {
    schema: {
      consumes: ['multipart/form-data'],
      body: z.object({
        image: z
          .custom<MultipartFile>()
          .refine((file) => file?.file, {
            message: 'The image is required.',
          })
          .refine((file) => file.file?.bytesRead <= 10 * 1024 * 1024, {
            message: 'The image must be a maximum of 10MB.',
          })
          .refine((file) => file.mimetype.startsWith('image'), {
            message: 'Only images are allowed to be sent.',
          }),
      }),
    },
  },
  async (request, reply) => {
    const { image } = request.body

    console.log({
      filename: image.filename,
      mimetype: image.mimetype,
      bytes: image.file.bytesRead,
    })

    return reply.send('OK')
  }
)

app.listen({ port: 8000 }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`Server listening at ${address}`)
})

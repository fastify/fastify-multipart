import * as fastifyMultipart from '..'
import { ajvFilePlugin } from '..'
import { expect } from 'tstyche'

expect(ajvFilePlugin).type.toBeAssignableTo<Function>()
expect(fastifyMultipart.ajvFilePlugin).type.toBe(ajvFilePlugin)

import fastify from "fastify";
import { fastifyMultipart } from "..";

const app = fastify();

app.register(fastifyMultipart);

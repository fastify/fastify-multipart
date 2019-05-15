// Definitions by: Jannik Keye <https://github.com/jannikkeye>

import busboy = require("busboy");
import fastify = require("fastify");

import { Server, IncomingMessage, ServerResponse } from 'http';
import { Readable } from "stream";

type MultipartHandler = (
    field: string,
    file: any,
    filename: string,
    encoding: string,
    mimetype: string,
) => void;

type MultipartOptions = {
    /**
     * Append the multipart parameters to the body object
     */
    addToBody?: boolean;

    /**
     * Add a shered schema to validate the input fields
     */
    sharedSchemaId?: string;

    /**
     * Manage the file stream like you need
     */
    onFile?: (fieldName: string, stream: Readable, filename: string, encoding: string, mimetype: string, body: any) => void;

    limits?: {
        /**
         * Max field name size in bytes
         */
        fieldNameSize?: number;

        /**
         * Max field value size in bytes
         */
        fieldSize?: number;

        /**
         * Max number of non-file fields
         */
        fields?: number;

        /**
         * For multipart forms, the max file size
         */
        fileSize?: number;

        /**
         * Max number of file fields
         */
        files?: number;

        /**
         * Max number of header key=>value pairs
         */
        headerPairs?: number;
    }
};

declare module "fastify" {
    interface FastifyRequest<HttpRequest> {
        isMultipart: () => boolean;
        multipart: (handler: MultipartHandler, next: (err: Error) => void, options?: MultipartOptions) => busboy.Busboy;
    }
}

declare const fastifyMultipart: fastify.Plugin<Server, IncomingMessage, ServerResponse, MultipartOptions>;

export = fastifyMultipart;

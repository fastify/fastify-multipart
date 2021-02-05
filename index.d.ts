import * as busboy from "busboy";
import { FastifyPlugin } from "fastify";
import { Readable } from 'stream';
import { FastifyError } from "fastify-error";

type MultipartHandler = (
    field: string,
    file: any,
    filename: string,
    encoding: string,
    mimetype: string,
) => void;

interface BodyEntry {
    data: Buffer,
    filename: string,
    encoding: string,
    mimetype: string,
    limit: false
}

export interface MultipartFields {
    [x: string]: Multipart | Multipart[];
}

export type Multipart<T = true> = T extends true ? MultipartFile : MultipartValue<T>;

interface MultipartFile {
  toBuffer: () => Promise<Buffer>,
  file: NodeJS.ReadableStream,
  filepath: string,
  fieldname: string,
  filename: string,
  encoding: string,
  mimetype: string,
  fields: MultipartFields
}

interface MultipartValue<T> {
  value: T
}

interface MultipartErrors {
    PartsLimitError: FastifyError,
    FilesLimitError: FastifyError,
    FieldsLimitError: FastifyError,
    PrototypeViolationError: FastifyError,
    InvalidMultipartContentTypeError: FastifyError,
    RequestFileTooLargeError: FastifyError
}

declare module "fastify" {
    interface FastifyRequest {
        isMultipart: () => boolean;

        parts: (options?: busboy.BusboyConfig) =>  AsyncIterableIterator<Multipart>

        // legacy
        multipart: (handler: MultipartHandler, next: (err: Error) => void, options?: busboy.BusboyConfig) => busboy.Busboy;

        // promise api
        multipartIterator: (options?: busboy.BusboyConfig) => AsyncIterableIterator<Multipart>

        // Stream mode
        file: (options?: busboy.BusboyConfig) => Promise<Multipart>
        files: (options?: busboy.BusboyConfig) => AsyncIterableIterator<Multipart>

        // Disk mode
        saveRequestFiles: (options?: busboy.BusboyConfig) => Promise<Array<Multipart>>
        cleanRequestFiles: () => Promise<void>
        tmpUploads: Array<Multipart>
    }

    interface FastifyInstance {
        multipartErrors: MultipartErrors
    }
}

export interface FastifyMultipartOptions {
    /**
     * Append the multipart parameters to the body object
     */
    addToBody?: boolean;

    /**
     * Only valid in the promise api. Append the multipart parameters to the body object.
     */
    attachFieldsToBody?: boolean

    /**
     * Add a shared schema to validate the input fields
     */
    sharedSchemaId?: string;

    /**
     * Allow throwing error when file size limit reached.
     */
    throwFileSizeLimit?: boolean

    /**
     * Manage the file stream like you need
     */
    onFile?: (fieldName: string, stream: Readable, filename: string, encoding: string, mimetype: string, body: Record<string, BodyEntry>) => void | Promise<void>;

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
}

declare const fastifyMultipart: FastifyPlugin<FastifyMultipartOptions>;
export default fastifyMultipart;

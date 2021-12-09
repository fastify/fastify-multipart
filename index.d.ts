import { Busboy, BusboyConfig, BusboyFileStream } from "@fastify/busboy";
import { FastifyPluginCallback } from "fastify";
import { Readable } from 'stream';
import { FastifyErrorConstructor } from "fastify-error";

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

export interface MultipartFile {
  toBuffer: () => Promise<Buffer>,
  file: BusboyFileStream,
  filepath: string,
  fieldname: string,
  filename: string,
  encoding: string,
  mimetype: string,
  fields: MultipartFields
}

export interface MultipartValue<T> {
  value: T
}

interface MultipartErrors {
    PartsLimitError: FastifyErrorConstructor,
    FilesLimitError: FastifyErrorConstructor,
    FieldsLimitError: FastifyErrorConstructor,
    PrototypeViolationError: FastifyErrorConstructor,
    InvalidMultipartContentTypeError: FastifyErrorConstructor,
    RequestFileTooLargeError: FastifyErrorConstructor
}

declare module "fastify" {
    interface FastifyRequest {
        isMultipart: () => boolean;

        // promise api
        parts: (options?: Omit<BusboyConfig, 'headers'>) =>  AsyncIterableIterator<Multipart>

        // legacy
        multipart: (handler: MultipartHandler, next: (err: Error) => void, options?: Omit<BusboyConfig, 'headers'>) => Busboy;

        // Stream mode
        file: (options?: Omit<BusboyConfig, 'headers'>) => Promise<Multipart>
        files: (options?: Omit<BusboyConfig, 'headers'>) => AsyncIterableIterator<Multipart>

        // Disk mode
        saveRequestFiles: (options?: Omit<BusboyConfig, 'headers'> & { tmpdir?: string }) => Promise<Array<Multipart>>
        cleanRequestFiles: () => Promise<void>
        tmpUploads: Array<Multipart>
    }

    interface FastifyInstance {
        multipartErrors: MultipartErrors
    }
}

export interface FastifyMultipartBaseOptions {
    /**
     * Append the multipart parameters to the body object
     */
    addToBody?: boolean;

    /**
     * Add a shared schema to validate the input fields
     */
    sharedSchemaId?: string;

    /**
     * Allow throwing error when file size limit reached.
     */
    throwFileSizeLimit?: boolean

    /**
     * Detect if a Part is a file.
     *
     * By default a file is detected if contentType
     * is application/octet-stream or fileName is not
     * undefined.
     *
     * Modify this to handle e.g. Blobs.
     */
    isPartAFile?: (fieldName: string | undefined, contentType: string | undefined, fileName: string | undefined) => boolean;

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

export interface FastifyMultipartOptions extends FastifyMultipartBaseOptions {
    /**
     * Only valid in the promise api. Append the multipart parameters to the body object.
     */
    attachFieldsToBody?: false

    /**
     * Manage the file stream like you need
     */
     onFile?: (fieldName: string, stream: Readable, filename: string, encoding: string, mimetype: string, body: Record<string, BodyEntry>) => void | Promise<void>;
}

export interface FastifyMultipartAttactFieldsToBodyOptions extends FastifyMultipartBaseOptions {
    /**
     * Only valid in the promise api. Append the multipart parameters to the body object.
     */
    attachFieldsToBody: true

    /**
     * Manage the file stream like you need
     */
    onFile?: (part: MultipartFile) => void | Promise<void>;
}

declare const fastifyMultipart: FastifyPluginCallback<FastifyMultipartOptions | FastifyMultipartAttactFieldsToBodyOptions>;
export default fastifyMultipart;

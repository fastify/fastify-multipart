import { Busboy, BusboyConfig, BusboyFileStream } from "@fastify/busboy";
import { FastifyPluginCallback, FastifyRequest } from "fastify";
import { Readable } from "stream";
import { FastifyErrorConstructor } from "@fastify/error";

declare module "fastify" {
  interface FastifyRequest {
    isMultipart: () => boolean;

    // promise api
    parts: (
      options?: Omit<BusboyConfig, "headers">
    ) => AsyncIterableIterator<fastifyMultipart.Multipart>;

    // legacy
    multipart: (
      handler: MultipartHandler,
      next: (err: Error) => void,
      options?: Omit<BusboyConfig, "headers">
    ) => Busboy;

    // Stream mode
    file: (
      options?: Omit<BusboyConfig, "headers">
    ) => Promise<fastifyMultipart.MultipartFile | undefined>;
    files: (
      options?: Omit<BusboyConfig, "headers">
    ) => AsyncIterableIterator<fastifyMultipart.MultipartFile>;

    // Disk mode
    saveRequestFiles: (
      options?: Omit<BusboyConfig, "headers"> & { tmpdir?: string }
    ) => Promise<Array<fastifyMultipart.SavedMultipartFile>>;
    cleanRequestFiles: () => Promise<void>;
    tmpUploads: Array<string> | null;
    /** This will get populated as soon as a call to `saveRequestFiles` gets resolved. Avoiding any future duplicate work */
    savedRequestFiles: Array<fastifyMultipart.SavedMultipartFile> | null;
  }

  interface FastifyInstance {
    multipartErrors: MultipartErrors;
  }
}

type FastifyMultipartPlugin = FastifyPluginCallback<
  | fastifyMultipart.FastifyMultipartBaseOptions
  | fastifyMultipart.FastifyMultipartOptions
  | fastifyMultipart.FastifyMultipartAttachFieldsToBodyOptions
>;

type MultipartHandler = (
  field: string,
  file: BusboyFileStream,
  filename: string,
  encoding: string,
  mimetype: string
) => void;

interface BodyEntry {
  data: Buffer;
  filename: string;
  encoding: string;
  mimetype: string;
  limit: false;
}

interface MultipartErrors {
  PartsLimitError: FastifyErrorConstructor;
  FilesLimitError: FastifyErrorConstructor;
  FieldsLimitError: FastifyErrorConstructor;
  PrototypeViolationError: FastifyErrorConstructor;
  InvalidMultipartContentTypeError: FastifyErrorConstructor;
  RequestFileTooLargeError: FastifyErrorConstructor;
}

declare namespace fastifyMultipart {
  export interface SavedMultipartFile extends MultipartFile {
    /**
     * Path to the temporary file
     */
    filepath: string;
  }

  export type Multipart = MultipartFile | MultipartValue;

  export interface MultipartFile {
    type: 'file';
    toBuffer: () => Promise<Buffer>;
    file: BusboyFileStream;
    fieldname: string;
    filename: string;
    encoding: string;
    mimetype: string;
    fields: MultipartFields;
  }

  export interface MultipartValue<T = unknown> {
    type: 'field';
    value: T;
    fieldname: string;
    mimetype: string;
    encoding: string;
    fieldnameTruncated: boolean;
    valueTruncated: boolean;
    fields: MultipartFields;
  }

  export interface MultipartFields {
    [fieldname: string]: Multipart | Multipart[] | undefined;
  }

  export interface FastifyMultipartBaseOptions {
    /**
     * Add a shared schema to validate the input fields
     */
    sharedSchemaId?: string;

    /**
     * Allow throwing error when file size limit reached.
     */
    throwFileSizeLimit?: boolean;

    /**
     * Detect if a Part is a file.
     *
     * By default a file is detected if contentType
     * is application/octet-stream or fileName is not
     * undefined.
     *
     * Modify this to handle e.g. Blobs.
     */
    isPartAFile?: (
      fieldName: string | undefined,
      contentType: string | undefined,
      fileName: string | undefined
    ) => boolean;

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
    };
  }

  export interface FastifyMultipartOptions extends FastifyMultipartBaseOptions {
    /**
     * Only valid in the promise api. Append the multipart parameters to the body object.
     */
    attachFieldsToBody?: false;

    /**
     * Manage the file stream like you need
     */
    onFile?: (
      fieldName: string,
      stream: Readable,
      filename: string,
      encoding: string,
      mimetype: string,
      body: Record<string, BodyEntry>
    ) => void | Promise<void>;
  }

  export interface FastifyMultipartAttachFieldsToBodyOptions
    extends FastifyMultipartBaseOptions {
    /**
     * Only valid in the promise api. Append the multipart parameters to the body object.
     */
    attachFieldsToBody: true | "keyValues";

    /**
     * Manage the file stream like you need
     */
    onFile?: (this: FastifyRequest, part: MultipartFile) => void | Promise<void>;
  }

  /**
   * Adds a new type `isFile` to help @fastify/swagger generate the correct schema.
   */
  export function ajvFilePlugin(ajv: any): void;

  export const fastifyMultipart: FastifyMultipartPlugin;
  export { fastifyMultipart as default };
}
declare function fastifyMultipart(
  ...params: Parameters<FastifyMultipartPlugin>
): ReturnType<FastifyMultipartPlugin>;

export = fastifyMultipart;

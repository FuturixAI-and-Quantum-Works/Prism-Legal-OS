import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { buildContentDisposition } from "./contentDisposition.js";
import {
  ObjectNotFoundError,
  ObjectStoreClosedError,
  ObjectStoreOperationError,
  type ObjectStore,
  type ObjectStoreCopy,
  type ObjectStoreHealth,
  type ObjectStorePut,
  type ObjectRef,
  type ObjectStoreSignRead,
} from "./types.js";

export type S3ObjectStoreDependencies = Readonly<{
  send: (command: object, signal: AbortSignal) => Promise<unknown>;
  sign: (command: object, expiresInSeconds: number) => Promise<string>;
  close: () => void;
}>;

export type S3ObjectStoreOptions = Readonly<{
  endpoint?: string;
  publicEndpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
  requestTimeoutMs: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissing(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error.name === "NoSuchKey" || error.name === "NotFound") return true;
  const metadata = error.$metadata;
  return isRecord(metadata) && metadata.httpStatusCode === 404;
}

function copySource(bucket: string, key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${encodeURIComponent(bucket)}/${encodedKey}`;
}

function createClient(options: S3ObjectStoreOptions, endpoint: string | undefined): S3Client {
  return new S3Client({
    region: options.region,
    endpoint,
    forcePathStyle: options.forcePathStyle,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  });
}

function defaultDependencies(options: S3ObjectStoreOptions): S3ObjectStoreDependencies {
  const client = createClient(options, options.endpoint);
  const signer =
    options.publicEndpoint && options.publicEndpoint !== options.endpoint
      ? createClient(options, options.publicEndpoint)
      : client;
  return {
    send: (command, signal) => {
      const options = { abortSignal: signal };
      if (command instanceof CopyObjectCommand) return client.send(command, options);
      if (command instanceof DeleteObjectCommand) return client.send(command, options);
      if (command instanceof GetObjectCommand) return client.send(command, options);
      if (command instanceof HeadBucketCommand) return client.send(command, options);
      if (command instanceof PutObjectCommand) return client.send(command, options);
      throw new ObjectStoreOperationError("health", "Unsupported S3 command");
    },
    sign: (command, expiresInSeconds) => {
      if (!(command instanceof GetObjectCommand)) {
        throw new ObjectStoreOperationError("signRead", "Unsupported S3 signing command");
      }
      return getSignedUrl(signer, command, { expiresIn: expiresInSeconds });
    },
    close: () => {
      client.destroy();
      if (signer !== client) signer.destroy();
    },
  };
}

export class S3ObjectStore implements ObjectStore {
  private readonly dependencies: S3ObjectStoreDependencies;
  private closed = false;

  constructor(
    private readonly options: S3ObjectStoreOptions,
    dependencies?: S3ObjectStoreDependencies,
  ) {
    this.dependencies = dependencies ?? defaultDependencies(options);
  }

  get requestTimeoutMs(): number {
    return this.options.requestTimeoutMs;
  }

  private send(command: object): Promise<unknown> {
    return this.dependencies.send(command, AbortSignal.timeout(this.options.requestTimeoutMs));
  }

  private assertOpen(): void {
    if (this.closed) throw new ObjectStoreClosedError();
  }

  async put(input: ObjectStorePut): Promise<void> {
    this.assertOpen();
    try {
      await this.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: input.ref,
          Body: Buffer.from(input.content),
          ContentType: input.contentType,
        }),
      );
    } catch (error) {
      throw new ObjectStoreOperationError("put", `Failed to put object: ${input.ref}`, {
        cause: error,
      });
    }
  }

  async get(ref: ObjectRef): Promise<ArrayBuffer> {
    this.assertOpen();
    try {
      const response = await this.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: ref }),
      );
      if (!isRecord(response) || !isRecord(response.Body)) {
        throw new ObjectStoreOperationError("get", `Object response has no body: ${ref}`);
      }
      const transform = response.Body.transformToByteArray;
      if (typeof transform !== "function") {
        throw new ObjectStoreOperationError("get", `Object response body is unreadable: ${ref}`);
      }
      const bytes: unknown = await transform.call(response.Body);
      if (!(bytes instanceof Uint8Array)) {
        throw new ObjectStoreOperationError("get", `Object response body is invalid: ${ref}`);
      }
      const result = new Uint8Array(bytes.byteLength);
      result.set(bytes);
      return result.buffer;
    } catch (error) {
      if (error instanceof ObjectStoreOperationError) throw error;
      if (isMissing(error)) throw new ObjectNotFoundError(ref, { cause: error });
      throw new ObjectStoreOperationError("get", `Failed to get object: ${ref}`, { cause: error });
    }
  }

  async delete(ref: ObjectRef): Promise<void> {
    this.assertOpen();
    try {
      await this.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: ref }));
    } catch (error) {
      if (isMissing(error)) return;
      throw new ObjectStoreOperationError("delete", `Failed to delete object: ${ref}`, {
        cause: error,
      });
    }
  }

  async copy(input: ObjectStoreCopy): Promise<void> {
    this.assertOpen();
    try {
      await this.send(
        new CopyObjectCommand({
          Bucket: this.options.bucket,
          Key: input.destinationRef,
          CopySource: copySource(this.options.bucket, input.sourceRef),
        }),
      );
    } catch (error) {
      if (isMissing(error)) throw new ObjectNotFoundError(input.sourceRef, { cause: error });
      throw new ObjectStoreOperationError(
        "copy",
        `Failed to copy object: ${input.sourceRef} to ${input.destinationRef}`,
        { cause: error },
      );
    }
  }

  async signRead(input: ObjectStoreSignRead): Promise<string> {
    this.assertOpen();
    const responseContentDisposition = input.downloadFilename
      ? buildContentDisposition(input.disposition ?? "attachment", input.downloadFilename)
      : undefined;
    try {
      return await this.dependencies.sign(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: input.ref,
          ResponseContentDisposition: responseContentDisposition,
        }),
        input.ttl,
      );
    } catch (error) {
      throw new ObjectStoreOperationError("signRead", `Failed to sign object read: ${input.ref}`, {
        cause: error,
      });
    }
  }

  async health(): Promise<ObjectStoreHealth> {
    this.assertOpen();
    try {
      await this.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
      return { kind: "healthy" };
    } catch {
      return {
        kind: "unhealthy",
        reason: "unavailable",
        error: new ObjectStoreOperationError("health", "S3 object storage is unavailable"),
      };
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dependencies.close();
  }
}

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeStorage,
  configureStorage,
  downloadFile,
  storageEnabled,
  uploadFile,
} from "../../src/lib/storage.js";
import {
  InvalidObjectKeyError,
  ObjectNotFoundError,
  ObjectStoreClosedError,
  ObjectStoreDisabledError,
  ObjectStoreOperationError,
  InvalidSignedReadTtlError,
  parseObjectRef,
  parseSignedReadTtl,
  type ObjectStore,
} from "../../src/storage/types.js";
import { DisabledObjectStore } from "../../src/storage/disabledObjectStore.js";
import { LocalFilesystemObjectStore } from "../../src/storage/localFilesystemObjectStore.js";
import { S3ObjectStore, type S3ObjectStoreDependencies } from "../../src/storage/s3ObjectStore.js";
import { verifyLocalRead } from "../../src/storage/localSignedRead.js";

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

function text(value: ArrayBuffer): string {
  return new TextDecoder().decode(value);
}

type StoreFixture = Readonly<{
  store: ObjectStore;
  readSigned: (url: string) => Promise<ArrayBuffer>;
  cleanup: () => Promise<void>;
}>;

function objectStoreContract(name: string, createFixture: () => Promise<StoreFixture>): void {
  describe(`${name} contract`, () => {
    let cleanup: (() => Promise<void>) | undefined;

    afterEach(async () => {
      await cleanup?.();
      cleanup = undefined;
    });

    async function create(): Promise<StoreFixture> {
      const fixture = await createFixture();
      cleanup = fixture.cleanup;
      return fixture;
    }

    it("puts, gets, and atomically overwrites objects", async () => {
      const { store } = await create();
      const ref = parseObjectRef("documents/one.txt");
      await store.put({
        ref,
        content: bytes("first"),
        contentType: "text/plain",
      });
      await store.put({
        ref,
        content: bytes("second"),
        contentType: "text/plain",
      });

      expect(text(await store.get(ref))).toBe("second");
    });

    it("copies and deletes objects", async () => {
      const { store } = await create();
      const sourceRef = parseObjectRef("source/data.bin");
      const destinationRef = parseObjectRef("target/data.bin");
      await store.put({
        ref: sourceRef,
        content: bytes("copy me"),
        contentType: "text/plain",
      });
      await store.copy({ sourceRef, destinationRef });

      expect(text(await store.get(destinationRef))).toBe("copy me");
      await store.delete(destinationRef);
      await store.delete(destinationRef);
      await expect(store.get(destinationRef)).rejects.toBeInstanceOf(ObjectNotFoundError);
    });

    it("overwrites copy destinations and reports a missing source", async () => {
      const { store } = await create();
      const sourceRef = parseObjectRef("source/data.bin");
      const destinationRef = parseObjectRef("target/data.bin");
      await store.put({ ref: sourceRef, content: bytes("source"), contentType: "text/plain" });
      await store.put({ ref: destinationRef, content: bytes("old"), contentType: "text/plain" });
      await store.copy({ sourceRef, destinationRef });

      expect(text(await store.get(destinationRef))).toBe("source");
      await expect(
        store.copy({
          sourceRef: parseObjectRef("missing/source"),
          destinationRef,
        }),
      ).rejects.toBeInstanceOf(ObjectNotFoundError);
    });

    it("reports missing keys with a typed error", async () => {
      const { store } = await create();
      await expect(store.get(parseObjectRef("missing/object"))).rejects.toBeInstanceOf(
        ObjectNotFoundError,
      );
    });

    it.each([
      "",
      ".",
      "..",
      "../escape",
      "safe/../../escape",
      "/absolute",
      "C:/absolute",
      "back\\slash",
      "nul\0byte",
      "trailing/",
      "double//slash",
    ])("rejects traversal or non-portable key %s", async (key) => {
      await create();
      expect(() => parseObjectRef(key)).toThrow(InvalidObjectKeyError);
    });

    it("reports healthy storage", async () => {
      const { store } = await create();
      await expect(store.health()).resolves.toEqual({ kind: "healthy" });
    });

    it("signs readable objects without checking existence first", async () => {
      const { store, readSigned } = await create();
      const ref = parseObjectRef("signed/object.txt");
      await store.put({ ref, content: bytes("signed contents"), contentType: "text/plain" });
      const url = await store.signRead({
        ref,
        ttl: parseSignedReadTtl(60),
      });
      expect(text(await readSigned(url))).toBe("signed contents");
      await expect(
        store.signRead({
          ref: parseObjectRef("missing/object"),
          ttl: parseSignedReadTtl(60),
        }),
      ).resolves.toMatch(/^https?:\/\//);
    });

    it("closes idempotently and rejects later operations", async () => {
      const { store } = await create();
      const ref = parseObjectRef("object");
      store.close();
      store.close();
      const failures = [
        store.put({ ref, content: bytes("value"), contentType: "text/plain" }),
        store.get(ref),
        store.delete(ref),
        store.copy({ sourceRef: ref, destinationRef: parseObjectRef("copy") }),
        store.signRead({ ref, ttl: parseSignedReadTtl(60) }),
        store.health(),
      ];
      for (const failure of failures) {
        await expect(failure).rejects.toBeInstanceOf(ObjectStoreClosedError);
      }
    });
  });
}

async function localFixture(): Promise<StoreFixture> {
  const directory = await mkdtemp(path.join(tmpdir(), "prism-object-store-"));
  const store = new LocalFilesystemObjectStore({
    directory,
    publicApiUrl: "http://localhost:3001",
    signingSecret: "local-object-store-test-secret",
  });
  return {
    store,
    readSigned: async (url) => {
      const token = new URL(url).pathname.split("/").at(-1);
      if (!token) throw new Error("Expected local read token");
      const signed = verifyLocalRead(token, "local-object-store-test-secret");
      if (!signed) throw new Error("Expected valid local read token");
      return store.get(signed.ref);
    },
    cleanup: async () => {
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function mockedS3Fixture(): Promise<StoreFixture> {
  const objects = new Map<string, Uint8Array>();
  let signedKey: string | undefined;
  const send = vi.fn(async (command: object): Promise<unknown> => {
    if (command instanceof PutObjectCommand) {
      if (!command.input.Key || !Buffer.isBuffer(command.input.Body))
        throw new Error("invalid put");
      objects.set(command.input.Key, new Uint8Array(command.input.Body));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const value = command.input.Key ? objects.get(command.input.Key) : undefined;
      if (!value) throw { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
      return { Body: { transformToByteArray: async () => new Uint8Array(value) } };
    }
    if (command instanceof DeleteObjectCommand) {
      if (command.input.Key) objects.delete(command.input.Key);
      return {};
    }
    if (command instanceof CopyObjectCommand) {
      const source = command.input.CopySource?.replace(/^prism\//, "");
      const value = source ? objects.get(decodeURIComponent(source)) : undefined;
      if (!value) throw { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
      if (!command.input.Key) throw new Error("invalid copy");
      objects.set(command.input.Key, new Uint8Array(value));
      return {};
    }
    if (command instanceof HeadBucketCommand) return {};
    throw new Error("unexpected command");
  });
  const dependencies: S3ObjectStoreDependencies = {
    send,
    sign: async (command) => {
      if (!(command instanceof GetObjectCommand) || !command.input.Key) {
        throw new Error("invalid signed read");
      }
      signedKey = command.input.Key;
      return "https://objects.example.com/signed";
    },
    close: vi.fn(),
  };
  const store = new S3ObjectStore(
    {
      endpoint: "https://storage.example.com",
      region: "auto",
      forcePathStyle: true,
      accessKeyId: "access",
      secretAccessKey: "secret",
      bucket: "prism",
      requestTimeoutMs: 60_000,
    },
    dependencies,
  );
  return Promise.resolve({
    store,
    readSigned: async () => {
      const value = signedKey ? objects.get(signedKey) : undefined;
      if (!value) throw new ObjectNotFoundError(signedKey ?? "unsigned");
      return new Uint8Array(value).buffer;
    },
    cleanup: async () => store.close(),
  });
}

objectStoreContract("local filesystem", localFixture);
objectStoreContract("mocked S3", mockedS3Fixture);

describe("LocalFilesystemObjectStore", () => {
  it("leaves no temporary files after an overwrite", async () => {
    const fixture = await localFixture();
    const { store } = fixture;
    try {
      const ref = parseObjectRef("atomic/file.txt");
      await store.put({ ref, content: bytes("old"), contentType: "text/plain" });
      await store.put({ ref, content: bytes("new"), contentType: "text/plain" });
      if (!(store instanceof LocalFilesystemObjectStore)) throw new Error("expected local store");
      expect(await readdir(path.join(store.root, "atomic"))).toEqual(["file.txt"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns only an application URL from signRead", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "prism-object-store-"));
    const store = new LocalFilesystemObjectStore({
      directory,
      publicApiUrl: "http://localhost:3001",
      signingSecret: "local-object-store-test-secret",
    });
    try {
      const url = await store.signRead({
        ref: parseObjectRef("documents/private/source.docx"),
        ttl: parseSignedReadTtl(60),
        downloadFilename: "contract.docx",
      });
      expect(url).toMatch(/^http:\/\/localhost:3001\/download\/local\//);
      expect(url).not.toContain("file:");
      expect(url).not.toContain(directory);
      expect(url).not.toContain("documents/private/source.docx");
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("signs expiry, disposition, and filename into a verifiable bearer token", async () => {
    const fixture = await localFixture();
    try {
      const url = await fixture.store.signRead({
        ref: parseObjectRef("documents/private/source.pdf"),
        ttl: parseSignedReadTtl(60),
        downloadFilename: "review.pdf",
        disposition: "inline",
      });
      const token = new URL(url).pathname.split("/").at(-1);
      if (!token) throw new Error("expected local read token");
      const signed = verifyLocalRead(token, "local-object-store-test-secret");
      expect(signed).toMatchObject({
        ref: "documents/private/source.pdf",
        filename: "review.pdf",
        disposition: "inline",
      });
      expect(
        verifyLocalRead(token, "local-object-store-test-secret", Number.MAX_SAFE_INTEGER),
      ).toBeNull();
      expect(verifyLocalRead(`${token}tampered`, "local-object-store-test-secret")).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects paths that traverse a symlink below the storage root", async () => {
    const fixture = await localFixture();
    const outside = await mkdtemp(path.join(tmpdir(), "prism-object-store-outside-"));
    try {
      const store = fixture.store;
      if (!(store instanceof LocalFilesystemObjectStore)) throw new Error("expected local store");
      await store.health();
      await writeFile(path.join(outside, "secret.txt"), "secret");
      await symlink(outside, path.join(store.root, "escape"));

      await expect(store.get(parseObjectRef("escape/secret.txt"))).rejects.toBeInstanceOf(
        InvalidObjectKeyError,
      );
      await expect(
        store.put({
          ref: parseObjectRef("escape/new.txt"),
          content: bytes("unsafe"),
          contentType: "text/plain",
        }),
      ).rejects.toBeInstanceOf(InvalidObjectKeyError);
      await store.delete(parseObjectRef("escape"));
      expect(await readdir(store.root)).not.toContain("escape");
    } finally {
      await fixture.cleanup();
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("ObjectStore value parsing", () => {
  it.each([0, -1, 1.5, 604_801, Number.NaN])("rejects invalid signed TTL %s", (value) => {
    expect(() => parseSignedReadTtl(value)).toThrow(InvalidSignedReadTtlError);
  });
});

describe("S3ObjectStore", () => {
  it("aborts requests at the configured timeout", async () => {
    const store = new S3ObjectStore(
      {
        endpoint: "https://storage.example.com",
        region: "auto",
        forcePathStyle: true,
        accessKeyId: "access",
        secretAccessKey: "secret",
        bucket: "prism",
        requestTimeoutMs: 1,
      },
      {
        send: (_command, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
        sign: async () => "https://objects.example.com/signed",
        close: vi.fn(),
      },
    );

    await expect(
      store.put({
        ref: parseObjectRef("documents/file"),
        content: bytes("value"),
        contentType: "text/plain",
      }),
    ).rejects.toBeInstanceOf(ObjectStoreOperationError);
    store.close();
  });

  it("creates a provider-signed read URL", async () => {
    const fixture = await mockedS3Fixture();
    try {
      await expect(
        fixture.store.signRead({
          ref: parseObjectRef("documents/file"),
          ttl: parseSignedReadTtl(30),
        }),
      ).resolves.toBe("https://objects.example.com/signed");
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    [
      "the public endpoint",
      "http://localhost:9000",
      "http://localhost:9000/prism/documents/file.pdf",
    ],
    [
      "the endpoint without a public endpoint",
      undefined,
      "http://minio:9000/prism/documents/file.pdf",
    ],
  ])("signs reads for %s", async (_label, publicEndpoint, expectedUrl) => {
    const store = new S3ObjectStore({
      endpoint: "http://minio:9000",
      publicEndpoint,
      region: "us-east-1",
      forcePathStyle: true,
      accessKeyId: "access",
      secretAccessKey: "secret",
      bucket: "prism",
      requestTimeoutMs: 60_000,
    });
    try {
      const url = new URL(
        await store.signRead({
          ref: parseObjectRef("documents/file.pdf"),
          ttl: parseSignedReadTtl(30),
        }),
      );
      expect(`${url.origin}${url.pathname}`).toBe(expectedUrl);
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
      expect(url.searchParams.get("X-Amz-Expires")).toBe("30");
    } finally {
      store.close();
    }
  });

  it("encodes each CopySource path segment", async () => {
    let commandSeen: CopyObjectCommand | undefined;
    const store = new S3ObjectStore(
      {
        endpoint: "https://storage.example.com",
        region: "auto",
        forcePathStyle: true,
        accessKeyId: "access",
        secretAccessKey: "secret",
        bucket: "prism",
        requestTimeoutMs: 60_000,
      },
      {
        send: async (command) => {
          if (command instanceof CopyObjectCommand) commandSeen = command;
          return {};
        },
        sign: async () => "https://objects.example.com/signed",
        close: vi.fn(),
      },
    );
    await store.copy({
      sourceRef: parseObjectRef("folder/a b?#.txt"),
      destinationRef: parseObjectRef("target/file.txt"),
    });

    expect(commandSeen?.input.CopySource).toBe("prism/folder/a%20b%3F%23.txt");
    store.close();
  });

  it("maps SDK failures and sanitizes health details", async () => {
    const close = vi.fn();
    const store = new S3ObjectStore(
      {
        endpoint: "https://secret-endpoint.example.com",
        region: "auto",
        forcePathStyle: true,
        accessKeyId: "secret-access-key",
        secretAccessKey: "secret-credential",
        bucket: "private-bucket",
        requestTimeoutMs: 60_000,
      },
      {
        send: async () => {
          throw new Error("secret-endpoint.example.com secret-credential");
        },
        sign: async () => "https://objects.example.com/signed",
        close,
      },
    );

    await expect(
      store.put({
        ref: parseObjectRef("object"),
        content: bytes("value"),
        contentType: "text/plain",
      }),
    ).rejects.toBeInstanceOf(ObjectStoreOperationError);
    const health = await store.health();
    expect(health.kind).toBe("unhealthy");
    if (health.kind === "healthy") throw new Error("expected unhealthy storage");
    expect(health.error.message).not.toMatch(/secret-endpoint|secret-credential|private-bucket/);
    expect(health.error.cause).toBeUndefined();
    store.close();
    store.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("DisabledObjectStore", () => {
  it("fails every data operation explicitly", async () => {
    const store = new DisabledObjectStore();
    const objectRef = parseObjectRef("object");
    const failures = [
      store.put({ ref: objectRef, content: bytes("value"), contentType: "text/plain" }),
      store.get(objectRef),
      store.delete(objectRef),
      store.copy({ sourceRef: objectRef, destinationRef: parseObjectRef("copy") }),
      store.signRead({ ref: objectRef, ttl: parseSignedReadTtl(60) }),
    ];

    for (const failure of failures) {
      await expect(failure).rejects.toBeInstanceOf(ObjectStoreDisabledError);
    }
    const health = await store.health();
    expect(health.kind).toBe("unhealthy");
    if (health.kind === "healthy") throw new Error("expected disabled health");
    expect(health.reason).toBe("disabled");
    expect(health.error).toBeInstanceOf(ObjectStoreDisabledError);
    store.close();
    store.close();
    await expect(store.get(objectRef)).rejects.toBeInstanceOf(ObjectStoreDisabledError);
  });
});

describe("configured object storage", () => {
  it("treats local storage as enabled and fails when disabled", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "prism-object-store-"));
    try {
      configureStorage(
        { kind: "local", directory, publicApiUrl: "http://localhost:3001" },
        "local-object-store-test-secret",
      );
      expect(storageEnabled).toBe(true);
      await uploadFile("configured/file.txt", bytes("configured"), "text/plain");
      expect(text((await downloadFile("configured/file.txt")) ?? bytes(""))).toBe("configured");

      configureStorage({ kind: "disabled" }, "local-object-store-test-secret");
      expect(storageEnabled).toBe(false);
      await expect(downloadFile("configured/file.txt")).rejects.toBeInstanceOf(
        ObjectStoreDisabledError,
      );
    } finally {
      closeStorage();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

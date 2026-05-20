import { Buffer } from "buffer";
import * as path from "path";
import { Readable } from "stream";
import type { PutObjectCommandInput, _Object } from "@aws-sdk/client-s3";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  ListObjectsV2Command,
  type ListObjectsV2CommandInput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { HttpHandlerOptions } from "@aws-sdk/types";
import {
  FetchHttpHandler,
  type FetchHttpHandlerOptions,
} from "@smithy/fetch-http-handler";
// @ts-ignore
import { requestTimeout } from "@smithy/fetch-http-handler/dist-es/request-timeout";
import { type HttpRequest, HttpResponse } from "@smithy/protocol-http";
import { buildQueryString } from "@smithy/querystring-builder";
// biome-ignore lint/suspicious/noShadowRestrictedNames: <explanation>
import AggregateError from "aggregate-error";
import * as mime from "mime-types";
import { Platform, type RequestUrlParam, requestUrl } from "obsidian";
import PQueue from "p-queue";
import {
  DEFAULT_CONTENT_TYPE,
  type ManifestEntry,
  type RemoteManifest,
  type S3Config,
} from "./baseTypes";
import { VALID_REQURL } from "./baseTypesObs";
import { bufferToArrayBuffer, getFolderLevels } from "./misc";

import type { Entity } from "./baseTypes";
import { FakeFs, type RemoteManifestStat, type RemoteSnapshot } from "./fsAll";

////////////////////////////////////////////////////////////////////////////////
// special handler using Obsidian requestUrl
////////////////////////////////////////////////////////////////////////////////

/**
 * This is close to origin implementation of FetchHttpHandler
 * https://github.com/aws/aws-sdk-js-v3/blob/main/packages/fetch-http-handler/src/fetch-http-handler.ts
 * that is released under Apache 2 License.
 * But this uses Obsidian requestUrl instead.
 */
class ObsHttpHandler extends FetchHttpHandler {
  requestTimeoutInMs: number | undefined;
  reverseProxyNoSignUrl: string | undefined;
  constructor(
    options?: FetchHttpHandlerOptions,
    reverseProxyNoSignUrl?: string
  ) {
    super(options);
    this.requestTimeoutInMs =
      options === undefined ? undefined : options.requestTimeout;
    this.reverseProxyNoSignUrl = reverseProxyNoSignUrl;
  }
  async handle(
    request: HttpRequest,
    { abortSignal }: HttpHandlerOptions = {}
  ): Promise<{ response: HttpResponse }> {
    if (abortSignal?.aborted) {
      const abortError = new Error("Request aborted");
      abortError.name = "AbortError";
      return Promise.reject(abortError);
    }

    let path = request.path;
    if (request.query) {
      const queryString = buildQueryString(request.query);
      if (queryString) {
        path += `?${queryString}`;
      }
    }

    const { port, method } = request;
    let url = `${request.protocol}//${request.hostname}${
      port ? `:${port}` : ""
    }${path}`;
    if (
      this.reverseProxyNoSignUrl !== undefined &&
      this.reverseProxyNoSignUrl !== ""
    ) {
      const urlObj = new URL(url);
      urlObj.host = this.reverseProxyNoSignUrl;
      url = urlObj.href;
    }
    const body =
      method === "GET" || method === "HEAD" ? undefined : request.body;

    const transformedHeaders: Record<string, string> = {};
    for (const key of Object.keys(request.headers)) {
      const keyLower = key.toLowerCase();
      if (keyLower === "host" || keyLower === "content-length") {
        continue;
      }
      transformedHeaders[keyLower] = request.headers[key];
    }

    let contentType: string | undefined = undefined;
    if (transformedHeaders["content-type"] !== undefined) {
      contentType = transformedHeaders["content-type"];
    }

    let transformedBody: any = body;
    if (ArrayBuffer.isView(body)) {
      transformedBody = bufferToArrayBuffer(body);
    }

    const param: RequestUrlParam = {
      body: transformedBody,
      headers: transformedHeaders,
      method: method,
      url: url,
      contentType: contentType,
    };

    const raceOfPromises = [
      requestUrl(param).then((rsp) => {
        const headers = rsp.headers;
        const headersLower: Record<string, string> = {};
        for (const key of Object.keys(headers)) {
          headersLower[key.toLowerCase()] = headers[key];
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(rsp.arrayBuffer));
            controller.close();
          },
        });
        return {
          response: new HttpResponse({
            headers: headersLower,
            statusCode: rsp.status,
            body: stream,
          }),
        };
      }),
      requestTimeout(this.requestTimeoutInMs),
    ];

    if (abortSignal) {
      raceOfPromises.push(
        new Promise<never>((resolve, reject) => {
          abortSignal.onabort = () => {
            const abortError = new Error("Request aborted");
            abortError.name = "AbortError";
            reject(abortError);
          };
        })
      );
    }
    return Promise.race(raceOfPromises);
  }
}

////////////////////////////////////////////////////////////////////////////////
// other stuffs
////////////////////////////////////////////////////////////////////////////////

export const simpleTransRemotePrefix = (x: string) => {
  if (x === undefined) {
    return "";
  }
  let y = path.posix.normalize(x.trim());
  if (y === undefined || y === "" || y === "/" || y === ".") {
    return "";
  }
  if (y.startsWith("/")) {
    y = y.slice(1);
  }
  if (!y.endsWith("/")) {
    y = `${y}/`;
  }
  return y;
};

export const DEFAULT_S3_CONFIG: S3Config = {
  s3Endpoint: "",
  s3Region: "",
  s3AccessKeyID: "",
  s3SecretAccessKey: "",
  s3BucketName: "",
  bypassCorsLocally: true,
  partsConcurrency: 20,
  forcePathStyle: false,
  remotePrefix: "",
  useAccurateMTime: false,
  reverseProxyNoSignUrl: "",
  generateFolderObject: false,
};

/**
 * The Body of resp of aws GetObject has mix types
 * and we want to get ArrayBuffer here.
 * See https://github.com/aws/aws-sdk-js-v3/issues/1877
 * @param b The Body of GetObject
 * @returns Promise<ArrayBuffer>
 */
const getObjectBodyToArrayBuffer = async (
  b: Readable | ReadableStream | Blob | undefined
) => {
  if (b === undefined) {
    throw Error(`ObjectBody is undefined and don't know how to deal with it`);
  }
  if (b instanceof Readable) {
    return (await new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      b.on("data", (chunk) => chunks.push(chunk));
      b.on("error", reject);
      b.on("end", () => resolve(bufferToArrayBuffer(Buffer.concat(chunks))));
    })) as ArrayBuffer;
  } else if (b instanceof ReadableStream) {
    return await new Response(b, {}).arrayBuffer();
  } else if (b instanceof Blob) {
    return await b.arrayBuffer();
  } else {
    throw TypeError(`The type of ${b} is not one of the supported types`);
  }
};

const getS3Client = (s3Config: S3Config) => {
  let endpoint = s3Config.s3Endpoint;
  if (!(endpoint.startsWith("http://") || endpoint.startsWith("https://"))) {
    endpoint = `https://${endpoint}`;
  }

  let s3Client: S3Client;
  if (VALID_REQURL && s3Config.bypassCorsLocally) {
    s3Client = new S3Client({
      region: s3Config.s3Region,
      endpoint: endpoint,
      forcePathStyle: s3Config.forcePathStyle,
      credentials: {
        accessKeyId: s3Config.s3AccessKeyID,
        secretAccessKey: s3Config.s3SecretAccessKey,
      },
      requestHandler: new ObsHttpHandler(
        undefined,
        s3Config.reverseProxyNoSignUrl
      ),
    });
  } else {
    s3Client = new S3Client({
      region: s3Config.s3Region,
      endpoint: endpoint,
      forcePathStyle: s3Config.forcePathStyle,
      credentials: {
        accessKeyId: s3Config.s3AccessKeyID,
        secretAccessKey: s3Config.s3SecretAccessKey,
      },
    });
  }

  s3Client.middlewareStack.add(
    (next, context) => (args) => {
      (args.request as any).headers["cache-control"] = "no-cache";
      return next(args);
    },
    {
      step: "build",
    }
  );

  return s3Client;
};

const getLocalNoPrefixPath = (
  fileOrFolderPathWithRemotePrefix: string,
  remotePrefix: string
) => {
  if (
    !(
      fileOrFolderPathWithRemotePrefix === `${remotePrefix}` ||
      fileOrFolderPathWithRemotePrefix.startsWith(`${remotePrefix}`)
    )
  ) {
    throw Error(
      `"${fileOrFolderPathWithRemotePrefix}" doesn't starts with "${remotePrefix}"`
    );
  }
  return fileOrFolderPathWithRemotePrefix.slice(`${remotePrefix}`.length);
};

const getRemoteWithPrefixPath = (
  fileOrFolderPath: string,
  remotePrefix: string
) => {
  if (remotePrefix === undefined || remotePrefix === "") {
    return fileOrFolderPath;
  }
  let key = fileOrFolderPath;
  if (fileOrFolderPath === "/" || fileOrFolderPath === "") {
    // special
    key = remotePrefix;
  }
  if (!fileOrFolderPath.startsWith("/")) {
    key = `${remotePrefix}${fileOrFolderPath}`;
  }
  return key;
};

const fromS3ObjectToEntity = (
  x: _Object,
  remotePrefix: string,
  mtimeRecords: Record<string, number>,
  ctimeRecords: Record<string, number>
) => {
  if (x.LastModified === undefined) {
    throw Error(
      `s3 object ${x.Key!} doesn't have LastModified value: ${JSON.stringify(
        x
      )}`
    );
  }
  const mtimeSvr = Math.floor(x.LastModified.valueOf() / 1000.0) * 1000;
  let mtimeCli = mtimeSvr;
  if (x.Key! in mtimeRecords) {
    const m2 = mtimeRecords[x.Key!];
    if (m2 !== 0) {
      if (m2 >= 1000000000000) {
        mtimeCli = m2;
      } else {
        mtimeCli = m2 * 1000;
      }
    }
  }
  const key = getLocalNoPrefixPath(x.Key!, remotePrefix);
  const r: Entity = {
    key: key,
    keyRaw: key,
    mtimeSvr: mtimeSvr,
    mtimeCli: mtimeCli,
    sizeRaw: x.Size!,
    size: x.Size!,
    etag: x.ETag,
    synthesizedFolder: false,
  };
  return r;
};

const fromS3HeadObjectToEntity = (
  fileOrFolderPathWithRemotePrefix: string,
  x: HeadObjectCommandOutput,
  remotePrefix: string,
  useAccurateMTime: boolean
) => {
  if (x.LastModified === undefined) {
    throw Error(
      `s3 object ${fileOrFolderPathWithRemotePrefix} doesn't have LastModified value: ${JSON.stringify(
        x
      )}`
    );
  }
  const mtimeSvr = Math.floor(x.LastModified.valueOf() / 1000.0) * 1000;
  let mtimeCli = mtimeSvr;
  if (useAccurateMTime && x.Metadata !== undefined) {
    // Metadata stores MTime as seconds (float with ms precision): e.g. "1716153600.123"
    // Parse directly to ms to avoid losing fractional seconds via Math.floor
    const m2 = Math.round(
      Number.parseFloat(x.Metadata.mtime || x.Metadata.MTime || "0") * 1000
    );
    if (m2 !== 0) {
      if (m2 >= 1000000000000) {
        mtimeCli = m2;
      } else {
        mtimeCli = m2 * 1000;
      }
    }
  }
  const key = getLocalNoPrefixPath(
    fileOrFolderPathWithRemotePrefix,
    remotePrefix
  );
  return {
    key: key,
    keyRaw: key,
    mtimeSvr: mtimeSvr,
    mtimeCli: mtimeCli,
    sizeRaw: x.ContentLength,
    size: x.ContentLength,
    etag: x.ETag,
    synthesizedFolder: false,
  } as Entity;
};

export class FakeFsS3 extends FakeFs {
  s3Config: S3Config;
  s3Client: S3Client;
  kind: "s3";
  synthFoldersCache: Record<string, Entity>;
  constructor(s3Config: S3Config) {
    super();
    this.s3Config = s3Config;
    this.s3Client = getS3Client(s3Config);
    this.kind = "s3";
    this.synthFoldersCache = {};
  }

  async walk(): Promise<Entity[]> {
    const res = (
      await this._walkFromRoot(this.s3Config.remotePrefix, false)
    ).filter(
      (x) =>
        x.keyRaw !== "" &&
        x.keyRaw !== "/" &&
        !x.keyRaw.startsWith("_rs_state/")
    );
    return res;
  }

  async walkPartial(): Promise<Entity[]> {
    const res = (
      await this._walkFromRoot(this.s3Config.remotePrefix, true)
    ).filter(
      (x) =>
        x.keyRaw !== "" &&
        x.keyRaw !== "/" &&
        !x.keyRaw.startsWith("_rs_state/")
    );
    return res;
  }

  async _walkFromRoot(prefixOfRawKeys: string | undefined, partial: boolean) {
    const confCmd = {
      Bucket: this.s3Config.s3BucketName,
    } as ListObjectsV2CommandInput;
    if (prefixOfRawKeys !== undefined && prefixOfRawKeys !== "") {
      confCmd.Prefix = prefixOfRawKeys;
    }
    if (partial) {
      confCmd.MaxKeys = 10;
    }

    const contents = [] as _Object[];
    const mtimeRecords: Record<string, number> = {};
    const ctimeRecords: Record<string, number> = {};
    const partsConcurrency = partial ? 1 : this.s3Config.partsConcurrency;
    const queueHead = new PQueue({
      concurrency: partsConcurrency,
      autoStart: true,
    });
    queueHead.on("error", (error) => {
      queueHead.pause();
      queueHead.clear();
      throw error;
    });

    let isTruncated = true;
    do {
      const rsp = await this.s3Client.send(new ListObjectsV2Command(confCmd));

      if (rsp.$metadata.httpStatusCode !== 200) {
        throw Error("some thing bad while listing remote!");
      }
      if (rsp.Contents === undefined) {
        break;
      }
      contents.push(...rsp.Contents);

      if (this.s3Config.useAccurateMTime) {
        for (const content of rsp.Contents) {
          queueHead.add(async () => {
            const rspHead = await this.s3Client.send(
              new HeadObjectCommand({
                Bucket: this.s3Config.s3BucketName,
                Key: content.Key,
              })
            );
            if (rspHead.$metadata.httpStatusCode !== 200) {
              throw Error("some thing bad while heading single object!");
            }
            if (rspHead.Metadata === undefined) {
              // pass
            } else {
              // Metadata stores timestamps as seconds (float with ms precision).
              // Convert directly to ms to avoid losing fractional seconds.
              mtimeRecords[content.Key!] = Math.round(
                Number.parseFloat(
                  rspHead.Metadata.mtime || rspHead.Metadata.MTime || "0"
                ) * 1000
              );
              ctimeRecords[content.Key!] = Math.round(
                Number.parseFloat(
                  rspHead.Metadata.ctime || rspHead.Metadata.CTime || "0"
                ) * 1000
              );
            }
          });
        }
      }

      if (partial) {
        isTruncated = false;
      } else {
        isTruncated = rsp.IsTruncated ?? false;
        confCmd.ContinuationToken = rsp.NextContinuationToken;
        if (
          isTruncated &&
          (confCmd.ContinuationToken === undefined ||
            confCmd.ContinuationToken === "")
        ) {
          throw Error("isTruncated is true but no continuationToken provided");
        }
      }
    } while (isTruncated);

    await queueHead.onIdle();

    const res: Entity[] = [];
    const realEnrities = new Set<string>();
    for (const remoteObj of contents) {
      const remoteEntity = fromS3ObjectToEntity(
        remoteObj,
        this.s3Config.remotePrefix ?? "",
        mtimeRecords,
        ctimeRecords
      );
      realEnrities.add(remoteEntity.key!);
      res.push(remoteEntity);

      for (const f of getFolderLevels(remoteEntity.key!, true)) {
        if (realEnrities.has(f)) {
          delete this.synthFoldersCache[f];
          continue;
        }
        if (
          !this.synthFoldersCache.hasOwnProperty(f) ||
          remoteEntity.mtimeSvr! >= this.synthFoldersCache[f].mtimeSvr!
        ) {
          this.synthFoldersCache[f] = {
            key: f,
            keyRaw: f,
            size: 0,
            sizeRaw: 0,
            sizeEnc: 0,
            mtimeSvr: remoteEntity.mtimeSvr,
            mtimeSvrFmt: remoteEntity.mtimeSvrFmt,
            mtimeCli: remoteEntity.mtimeCli,
            mtimeCliFmt: remoteEntity.mtimeCliFmt,
            synthesizedFolder: true,
          };
        }
      }
    }
    for (const key of Object.keys(this.synthFoldersCache)) {
      res.push(this.synthFoldersCache[key]);
    }
    return res;
  }

  async stat(key: string): Promise<Entity> {
    if (this.synthFoldersCache.hasOwnProperty(key)) {
      return this.synthFoldersCache[key];
    }
    let keyFullPath = key;
    keyFullPath = getRemoteWithPrefixPath(
      keyFullPath,
      this.s3Config.remotePrefix ?? ""
    );
    return await this._statFromRoot(keyFullPath);
  }

  async _statFromRoot(key: string): Promise<Entity> {
    if (
      this.s3Config.remotePrefix !== undefined &&
      this.s3Config.remotePrefix !== "" &&
      !key.startsWith(this.s3Config.remotePrefix)
    ) {
      throw Error(`_statFromRoot should only accept prefix-ed path`);
    }
    const res = await this.s3Client.send(
      new HeadObjectCommand({
        Bucket: this.s3Config.s3BucketName,
        Key: key,
      })
    );

    return fromS3HeadObjectToEntity(
      key,
      res,
      this.s3Config.remotePrefix ?? "",
      this.s3Config.useAccurateMTime ?? false
    );
  }

  async mkdir(key: string, mtime?: number, ctime?: number): Promise<Entity> {
    if (!key.endsWith("/")) {
      throw new Error(`You should not call mkdir on ${key}!`);
    }

    const generateFolderObject = this.s3Config.generateFolderObject ?? false;
    if (!generateFolderObject) {
      const synth = {
        key: key,
        keyRaw: key,
        size: 0,
        sizeRaw: 0,
        sizeEnc: 0,
        mtimeSvr: mtime,
        mtimeCli: mtime,
        synthesizedFolder: true,
      };
      this.synthFoldersCache[key] = synth;
      return synth;
    }

    const uploadFile = getRemoteWithPrefixPath(
      key,
      this.s3Config.remotePrefix ?? ""
    );
    return await this._mkdirFromRoot(uploadFile, mtime, ctime);
  }

  async _mkdirFromRoot(key: string, mtime?: number, ctime?: number) {
    if (
      this.s3Config.remotePrefix !== undefined &&
      this.s3Config.remotePrefix !== "" &&
      !key.startsWith(this.s3Config.remotePrefix)
    ) {
      throw Error(`_mkdirFromRoot should only accept prefix-ed path`);
    }

    const contentType = DEFAULT_CONTENT_TYPE;
    const p: PutObjectCommandInput = {
      Bucket: this.s3Config.s3BucketName,
      Key: key,
      Body: "",
      ContentType: contentType,
      ContentLength: 0,
    };
    const metadata: Record<string, string> = {};
    if (mtime !== undefined && mtime !== 0) {
      metadata["MTime"] = `${mtime / 1000.0}`;
    }
    if (ctime !== undefined && ctime !== 0) {
      metadata["CTime"] = `${ctime / 1000.0}`;
    }
    if (Object.keys(metadata).length > 0) {
      p["Metadata"] = metadata;
    }
    await this.s3Client.send(new PutObjectCommand(p));
    return await this._statFromRoot(key);
  }

  async writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<Entity> {
    const uploadFile = getRemoteWithPrefixPath(
      key,
      this.s3Config.remotePrefix ?? ""
    );
    const res = await this._writeFileFromRoot(
      uploadFile,
      content,
      mtime,
      ctime
    );
    return res;
  }

  async _writeFileFromRoot(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<Entity> {
    if (
      this.s3Config.remotePrefix !== undefined &&
      this.s3Config.remotePrefix !== "" &&
      !key.startsWith(this.s3Config.remotePrefix)
    ) {
      throw Error(`_writeFileFromRoot should only accept prefix-ed path`);
    }

    const bytesIn5MB = 5242880;
    const body = new Uint8Array(content);

    let contentType = DEFAULT_CONTENT_TYPE;
    contentType =
      mime.contentType(mime.lookup(key) || DEFAULT_CONTENT_TYPE) ||
      DEFAULT_CONTENT_TYPE;

    const upload = new Upload({
      client: this.s3Client,
      queueSize: this.s3Config.partsConcurrency,
      partSize: bytesIn5MB,
      leavePartsOnError: false,
      params: {
        Bucket: this.s3Config.s3BucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: {
          MTime: `${mtime / 1000.0}`,
          CTime: `${ctime / 1000.0}`,
        },
      },
    });
    upload.on("httpUploadProgress", (progress) => {
      // console.info(progress);
    });
    await upload.done();

    return await this._statFromRoot(key);
  }

  async readFile(key: string): Promise<ArrayBuffer> {
    if (key.endsWith("/")) {
      throw new Error(`you should not call readFile on folder ${key}`);
    }
    const downloadFile = getRemoteWithPrefixPath(
      key,
      this.s3Config.remotePrefix ?? ""
    );

    return await this._readFileFromRoot(downloadFile);
  }

  async _readFileFromRoot(key: string): Promise<ArrayBuffer> {
    if (
      this.s3Config.remotePrefix !== undefined &&
      this.s3Config.remotePrefix !== "" &&
      !key.startsWith(this.s3Config.remotePrefix)
    ) {
      throw Error(`_readFileFromRoot should only accept prefix-ed path`);
    }
    const data = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.s3Config.s3BucketName,
        Key: key,
      })
    );
    const bodyContents = await getObjectBodyToArrayBuffer(data.Body);
    return bodyContents;
  }

  async rename(key1: string, key2: string): Promise<void> {
    throw Error(`rename not implemented for s3`);
  }

  async rm(key: string): Promise<void> {
    if (key === "/") {
      return;
    }

    if (key.endsWith("/")) {
      if (this.synthFoldersCache.hasOwnProperty(key)) {
        delete this.synthFoldersCache[key];
        return;
      }

      try {
        const remoteFileName = getRemoteWithPrefixPath(
          key,
          this.s3Config.remotePrefix ?? ""
        );

        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.s3Config.s3BucketName,
            Key: remoteFileName,
          })
        );
      } catch (e) {
        // pass
      }
    } else {
      const remoteFileName = getRemoteWithPrefixPath(
        key,
        this.s3Config.remotePrefix ?? ""
      );

      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.s3Config.s3BucketName,
          Key: remoteFileName,
        })
      );
    }
  }

  async rmBatch(keys: string[]): Promise<void> {
    const CHUNK_SIZE = 1000;
    const remotePrefix = this.s3Config.remotePrefix ?? "";
    for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
      const chunk = keys.slice(i, i + CHUNK_SIZE);
      const objects = chunk.map((k) => ({
        Key: getRemoteWithPrefixPath(k, remotePrefix),
      }));
      try {
        const result = await this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: this.s3Config.s3BucketName,
            Delete: { Objects: objects, Quiet: true },
          })
        );
        if (result.Errors && result.Errors.length > 0) {
          // Retry failed keys individually
          for (const err of result.Errors) {
            if (err.Key) {
              console.warn(`rmBatch retrying failed key: ${err.Key}`);
              await this.s3Client.send(
                new DeleteObjectCommand({
                  Bucket: this.s3Config.s3BucketName,
                  Key: err.Key,
                })
              );
            }
          }
        }
      } catch (e) {
        console.warn(
          `rmBatch chunk failed, falling back to individual deletes: ${e}`
        );
        for (const obj of objects) {
          try {
            await this.s3Client.send(
              new DeleteObjectCommand({
                Bucket: this.s3Config.s3BucketName,
                Key: obj.Key,
              })
            );
          } catch (e2) {
            console.warn(
              `rmBatch individual delete failed for ${obj.Key}: ${e2}`
            );
          }
        }
      }
    }
  }

  async checkConnect(callbackFunc?: any): Promise<boolean> {
    try {
      const confCmd = {
        Bucket: this.s3Config.s3BucketName,
      } as ListObjectsV2CommandInput;
      const results = await this.s3Client.send(
        new ListObjectsV2Command(confCmd)
      );

      if (
        results === undefined ||
        results.$metadata === undefined ||
        results.$metadata.httpStatusCode === undefined
      ) {
        throw Error("results or $metadata or httStatusCode is undefined");
      }
      if (results.$metadata.httpStatusCode !== 200) {
        throw Error(`not 200 httpStatusCode`);
      }
    } catch (err: any) {
      console.debug(err);
      if (callbackFunc !== undefined) {
        if (this.s3Config.s3Endpoint.includes(this.s3Config.s3BucketName)) {
          const err2 = new AggregateError([
            err,
            new Error(
              "Maybe you've included the bucket name inside the endpoint setting. Please remove the bucket name and try again."
            ),
          ]);
          callbackFunc(err2);
        } else {
          callbackFunc(err);
        }
      }
      return false;
    }

    return await this.checkConnectCommonOps(callbackFunc);
  }

  async getUserDisplayName(): Promise<string> {
    throw new Error("Method not implemented.");
  }

  async revokeAuth() {
    throw new Error("Method not implemented.");
  }

  allowEmptyFile(): boolean {
    return true;
  }

  async checkRemoteChanges(): Promise<RemoteSnapshot | null> {
    try {
      const confCmd = {
        Bucket: this.s3Config.s3BucketName,
        MaxKeys: 200,
      } as ListObjectsV2CommandInput;
      if (
        this.s3Config.remotePrefix !== undefined &&
        this.s3Config.remotePrefix !== ""
      ) {
        confCmd.Prefix = this.s3Config.remotePrefix;
      }

      const rsp = await this.s3Client.send(new ListObjectsV2Command(confCmd));

      if (!rsp.Contents || rsp.$metadata.httpStatusCode !== 200) {
        return null;
      }

      const objectCount = rsp.KeyCount ?? rsp.Contents.length;
      let newestMtime = 0;
      const newestItems: { key: string; mtime: number }[] = [];

      for (const obj of rsp.Contents) {
        const ms = obj.LastModified?.getTime() ?? 0;
        if (ms > newestMtime) {
          newestMtime = ms;
        }
        newestItems.push({
          key: obj.Key ?? "",
          mtime: ms,
        });
      }

      // Sort by mtime descending and take up to 10 sample keys
      newestItems.sort((a, b) => b.mtime - a.mtime);
      const sampleKeys = newestItems
        .slice(0, 10)
        .map((x) => x.key)
        .filter((k) => k !== "");

      return {
        objectCount,
        newestMtime: objectCount > 0 ? newestMtime : null,
        sampleKeys,
        capturedAt: Date.now(),
      };
    } catch (e) {
      console.debug(`checkRemoteChanges (S3) failed: ${e}`);
      return null;
    }
  }

  // ── Remote Manifest (PRD S3 Native Manifest Sync) ──

  /**
   * Get the S3 key for the manifest file.
   */
  private getManifestKey(vaultRandomID: string): string {
    const prefix = this.s3Config.remotePrefix ?? "";
    return `${prefix}_rs_state/${vaultRandomID}/manifest.json`;
  }

  async readManifest(vaultRandomID: string): Promise<RemoteManifest | null> {
    try {
      const key = this.getManifestKey(vaultRandomID);
      const data = await this._readFileFromRoot(key);
      const text = new TextDecoder().decode(data);
      return JSON.parse(text) as RemoteManifest;
    } catch {
      return null;
    }
  }

  async writeManifest(
    vaultRandomID: string,
    manifest: RemoteManifest
  ): Promise<void> {
    const key = this.getManifestKey(vaultRandomID);
    const json = JSON.stringify(manifest);
    const data = new TextEncoder().encode(json).buffer;
    await this._writeFileFromRoot(
      key,
      data as ArrayBuffer,
      Date.now(),
      Date.now()
    );
  }

  async statManifest(
    vaultRandomID: string
  ): Promise<RemoteManifestStat | null> {
    try {
      const key = this.getManifestKey(vaultRandomID);
      const rsp = await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.s3Config.s3BucketName,
          Key: key,
        })
      );
      return {
        etag: rsp.ETag ?? "",
        lastModified: rsp.LastModified?.getTime() ?? null,
        size: rsp.ContentLength ?? null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Walk the remote using a cached manifest with bounded verification.
   *
   * 1. Does a single ListObjectsV2 (up to 1000 keys) to get current ETags.
   * 2. Compares with the manifest to find new/modified/deleted keys.
   * 3. If the total object count matches the manifest count AND all ETags match,
   *    the manifest is fresh → build entities from manifest (no full walk needed).
   * 4. If there are discrepancies, fall back to the full walk.
   */
  async walkFromManifest(manifest: RemoteManifest): Promise<Entity[]> {
    const remotePrefix = this.s3Config.remotePrefix ?? "";
    const manifestPath = this.getManifestKey(manifest.vaultRandomID);

    // Step 1: Bounded scan — get up to 1000 keys with ETags
    const scanCmd = {
      Bucket: this.s3Config.s3BucketName,
      Prefix: remotePrefix,
      MaxKeys: 1000,
    } as ListObjectsV2CommandInput;

    const rsp = await this.s3Client.send(new ListObjectsV2Command(scanCmd));

    if (!rsp.Contents || rsp.$metadata.httpStatusCode !== 200) {
      // Can't verify manifest, fall back to full walk
      console.info("manifest verif scan failed, falling back to full walk");
      this.manifestBasedWalk = false;
      return this.walk();
    }

    // Build a map of remote key → {etag, lastModified} from the scan
    const scannedEntries = new Map<
      string,
      { etag: string; lastModified: number }
    >();
    for (const obj of rsp.Contents) {
      scannedEntries.set(obj.Key!, {
        etag: obj.ETag ?? "",
        lastModified: obj.LastModified?.getTime() ?? 0,
      });
    }

    // Exclude the manifest file itself from comparison
    scannedEntries.delete(manifestPath);

    const manifestCount = Object.keys(manifest.files).length;
    const scanCount = scannedEntries.size;
    const isTruncated = rsp.IsTruncated ?? false;

    // Step 2: Check if manifest is fresh
    let manifestFresh = true;

    if (isTruncated) {
      // Scan didn't cover all objects — manifest might be incomplete
      manifestFresh = false;
      console.info(
        `manifest verif scan truncated (scanned ${scanCount}, manifest has ${manifestCount}), full walk needed`
      );
    } else if (scanCount !== manifestCount) {
      // Object count mismatch
      manifestFresh = false;
      console.info(
        `manifest count mismatch: manifest ${manifestCount} vs remote ${scanCount}`
      );
    } else {
      // Compare ETags: manifest vs scan
      for (const [relPath, entry] of Object.entries(manifest.files)) {
        const remoteKey = `${remotePrefix}${relPath}`;
        const scanned = scannedEntries.get(remoteKey);
        if (!scanned) {
          // Key in manifest but not on remote → deleted
          manifestFresh = false;
          break;
        }
        if (scanned.etag !== "" && scanned.etag !== entry.etag) {
          // ETag mismatch → modified
          manifestFresh = false;
          break;
        }
      }
    }

    this.manifestBasedWalk = manifestFresh;

    if (manifestFresh) {
      // Manifest is fresh → build entities from manifest
      console.info(
        `manifest is fresh (${manifestCount} files), using manifest data`
      );
      return this._manifestToEntities(manifest);
    }

    // Step 3: Manifest is stale, fall back to full walk
    console.info("manifest is stale, falling back to full walk");
    return this.walk();
  }

  /**
   * Convert manifest entries to Entity[].
   */
  private _manifestToEntities(manifest: RemoteManifest): Entity[] {
    const remotePrefix = this.s3Config.remotePrefix ?? "";
    const entities: Entity[] = [];

    for (const [relPath, entry] of Object.entries(manifest.files)) {
      const key = getLocalNoPrefixPath(
        `${remotePrefix}${relPath}`,
        remotePrefix
      );
      entities.push({
        key,
        keyRaw: key,
        mtimeCli: entry.mtime,
        mtimeSvr: entry.mtime,
        size: entry.size,
        sizeRaw: entry.size,
        etag: entry.etag,
        synthesizedFolder: false,
      });

      // Add synthetic folder entries
      for (const f of getFolderLevels(key, true)) {
        if (!entities.some((e) => e.keyRaw === f)) {
          entities.push({
            key: f,
            keyRaw: f,
            size: 0,
            sizeRaw: 0,
            mtimeSvr: entry.mtime,
            mtimeCli: entry.mtime,
            synthesizedFolder: true,
          });
        }
      }
    }

    return entities;
  }
}

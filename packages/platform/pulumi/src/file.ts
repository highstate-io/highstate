import type { EntityWithMeta, FileContent, FileMeta } from "@highstate/contract"
import { crc32 } from "node:zlib"
import { type Input, type Output, output, type Unwrap } from "@pulumi/pulumi"
import { makeSecret } from "./entity"
import { toPromise } from "./utils"

/**
 * The BaseFile is type that compatible with both the contract's File type and the file entity used in the library.
 *
 * It should be used in most places instead of the contract's File type to avoid unnecessary conversions, and it can be safely cast to the contract's File type when needed.
 */
export type BaseFile = EntityWithMeta & {
  meta: FileMeta
  content: FileContent
}

export type FileOptions = {
  /**
   * The name of the file.
   */
  name: Input<string>

  /**
   * The content of the file as a string or a buffer.
   */
  content: Input<string | Buffer>

  /**
   * The identity to use for the file entity.
   *
   * If not provided, defaults to the hash of the content.
   */
  identity?: Input<string>

  /**
   * Whether the content should be treated as a secret or not.
   */
  isSecret?: Input<boolean>

  /**
   * The content type of the file.
   *
   * Defaults to "text/plain" if the content is a string and "application/octet-stream" if the content is a buffer.
   */
  contentType?: Input<string>

  /**
   * The file mode (permissions) to set on the file when materialized.
   *
   * Defaults to 0o644.
   */
  mode?: Input<number>
}

/**
 * Creates a file entity from the given options.
 *
 * This file can also be used for both:
 * - core Highstate capabilities like terminals and pages;
 * - as inputs for other units requiring files.
 */
export function makeFile({
  name,
  content,
  contentType,
  identity,
  isSecret,
  mode,
}: Unwrap<FileOptions>): BaseFile {
  const stringContent = typeof content === "string" ? content : content.toString("base64")
  const isBinary = typeof content !== "string"
  const inferredContentType =
    contentType ?? (typeof content === "string" ? "text/plain" : "application/octet-stream")
  const size =
    typeof content === "string" ? Buffer.byteLength(content, "utf-8") : content.byteLength

  return {
    $meta: {
      type: "common.file.v1",
      identity: identity ?? crc32(stringContent).toString(16), // use crc32 hash of the content as the default identity
    },
    meta: {
      name,
      contentType: inferredContentType,
      size,
      mode,
    },
    content: isSecret
      ? { type: "embedded-secret", value: makeSecret(stringContent), isBinary }
      : { type: "embedded", value: stringContent, isBinary },
  }
}

/**
 * Similar to `makeFile`, but returns a Pulumi Output that resolves to a file entity.
 */
export function makeFileOutput(options: FileOptions): Output<BaseFile> {
  return output(options).apply(opts => makeFile(opts))
}

/**
 * Similar to `makeFile`, but returns a Promise that resolves to a file entity.
 */
export function makeFileAsync(options: FileOptions): Promise<BaseFile> {
  return toPromise(makeFileOutput(options))
}

import type { File } from "@highstate/contract"
import { type Input, type Output, output, secret } from "@pulumi/pulumi"

export type FileOptions = {
  isSecret?: boolean
  contentType?: Input<string>
  mode?: Input<number>
}

/**
 * Creates a file from a string input.
 * This file can then be passed to terminals/pages or other components.
 *
 * @param name The name of the file.
 * @param content The content of the file.
 * @param options Additional options for the file.
 */
export function fileFromString(
  name: Input<string>,
  content: Input<string>,
  { contentType = "text/plain", isSecret = false, mode }: FileOptions = {},
): Output<File> {
  return output({
    meta: {
      name,
      contentType,
      size: output(content).apply(content => Buffer.byteLength(content, "utf8")),
      mode,
    },
    content: {
      type: "embedded",
      value: isSecret ? secret(content) : content,
    },
  })
}

/**
 * Creates a file from a buffer input.
 * This file can then be passed to terminals/pages or other components.
 *
 * @param name The name of the file.
 * @param content The content of the file as a Buffer.
 * @param options Additional options for the file.
 */
export function fileFromBuffer(
  name: Input<string>,
  content: Buffer,
  { contentType = "application/octet-stream", isSecret = false, mode }: FileOptions = {},
): Output<File> {
  // const base64Content = output(content).apply(
  // c => (console.log("fileFromBuffer", c), c.toString("base64")),
  // )
  const base64Content = content.toString("base64")

  return output({
    meta: {
      name,
      contentType,
      size: output(content).apply(content => content.byteLength),
      mode,
    },
    content: {
      type: "embedded",
      isBinary: true,
      value: isSecret ? secret(base64Content) : base64Content,
    },
  })
}

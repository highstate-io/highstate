import type { rustfs } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type Output,
  output,
} from "@highstate/pulumi"
import { S3Bucket } from "@pulumi/minio"
import { getProvider } from "./provider"

export type BucketArgs = {
  /**
   * The RustFS instance where the bucket should be created.
   */
  connection: Input<rustfs.Connection>

  /**
   * The name of the bucket to create.
   */
  name: Input<string>
}

export class Bucket extends ComponentResource {
  /**
   * The connection associated with the bucket.
   */
  readonly connection: Output<rustfs.Connection>

  /**
   * The underlying S3-compatible RustFS bucket resource.
   */
  readonly bucket: Output<S3Bucket>

  constructor(name: string, args: BucketArgs, opts?: ComponentResourceOptions) {
    super("highstate:rustfs:Bucket", name, args, opts)

    this.connection = output(args.connection)
    this.bucket = this.connection.apply(async connection => {
      const provider = await getProvider(connection)

      return new S3Bucket(
        name,
        {
          bucket: args.name,
          forceDestroy: true,
        },
        {
          ...opts,
          provider,
          parent: this,
        },
      )
    })
  }
}

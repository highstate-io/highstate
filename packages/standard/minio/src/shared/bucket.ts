import type { minio } from "@highstate/library"
import { parseSizeString } from "@highstate/common"
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
   * The connection to the MinIO instance where the bucket should be created.
   */
  connection: Input<minio.Connection>

  /**
   * The name of the bucket to create.
   *
   * If not provided, matches the name of the resource.
   */
  name?: Input<string>

  /**
   * The quota to set as string with a size suffix (e.g. "10GB").
   *
   * If not provided, no quota will be set on the bucket.
   */
  quota?: Input<string>
}

export class Bucket extends ComponentResource {
  /**
   * The connection associated with the bucket.
   */
  readonly connection: Output<minio.Connection>

  /**
   * The underlying bucket resource of the `@pulumi/minio` provider.
   */
  readonly bucket: Output<S3Bucket>

  constructor(name: string, args: BucketArgs, opts?: ComponentResourceOptions) {
    super("highstate:minio:Bucket", name, args, opts)

    this.connection = output(args.connection)

    this.bucket = this.connection.apply(async connection => {
      const { provider, hooks } = await getProvider(connection)

      return new S3Bucket(
        name,
        {
          bucket: args.name ?? name,
          quota: args.quota ? output(args.quota).apply(parseSizeString) : undefined,
          forceDestroy: true,
        },
        {
          ...opts,
          provider,
          hooks,
          parent: this,
        },
      )
    })
  }
}

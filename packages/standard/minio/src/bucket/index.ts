import { minio } from "@highstate/library"
import { forUnit, interpolate, output, toPromise } from "@highstate/pulumi"
import { IamServiceAccount, Provider, S3Bucket } from "@pulumi/minio"
import { l4EndpointToString, parseSizeString, resolveEndpoint } from "@highstate/common"

const { args, inputs, name, outputs } = forUnit(minio.bucket)

await using endpoint = await resolveEndpoint(inputs.connection.endpoints)

const provider = new Provider(
  "provider",
  {
    minioServer: l4EndpointToString(endpoint),
    minioSsl: endpoint.appProtocol === "https",
    minioUser: inputs.connection.credentials.username,
    minioPassword: inputs.connection.credentials.password,
    minioRegion: inputs.connection.region,
  },
  {
    hooks: {
      beforeDelete: endpoint.beforeDeleteHooks,
      afterDelete: endpoint.afterDeleteHooks,
    },
  },
)

const bucket = new S3Bucket(
  "bucket",
  {
    bucket: args.bucketName ?? name,
    quota: args.quota ? parseSizeString(args.quota) : undefined,
    forceDestroy: true,
  },
  {
    provider,
    hooks: {
      beforeDelete: endpoint.beforeDeleteHooks,
    },
  },
)

const serviceAccount = new IamServiceAccount(
  "service-account",
  {
    targetUser: inputs.connection.credentials.username,
    policy: output({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "s3:*",
          Resource: [
            interpolate`arn:aws:s3:::${bucket.bucket}`,
            interpolate`arn:aws:s3:::${bucket.bucket}/*`,
          ],
        },
      ],
    }).apply(JSON.stringify),
  },
  {
    provider,
    hooks: {
      beforeDelete: endpoint.beforeDeleteHooks,
    },
  },
)

// wait before stopping the port-forward
await toPromise(serviceAccount.id)

export default outputs({
  bucket: {
    name: bucket.bucket,
    endpoints: inputs.connection.endpoints,
    region: inputs.connection.region,
    credentials: {
      accessKey: serviceAccount.accessKey,
      secretKey: serviceAccount.secretKey,
    },
  },

  $statusFields: {
    accessKey: serviceAccount.accessKey,
  },
})

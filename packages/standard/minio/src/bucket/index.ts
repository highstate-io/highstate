import { minio, s3 } from "@highstate/library"
import { forUnit, interpolate, makeEntityOutput, output } from "@highstate/pulumi"
import { Bucket, ServiceAccount } from "../shared"

const { stateId, args, inputs, name, outputs } = forUnit(minio.bucket)

const bucket = new Bucket("bucket", {
  connection: inputs.connection,
  name: args.bucketName ?? name,
  quota: args.quota,
})

const serviceAccount = new ServiceAccount("service-account", {
  connection: inputs.connection,
  user: inputs.connection.credentials.username,
  policy: output({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: "s3:*",
        Resource: [
          interpolate`arn:aws:s3:::${bucket.bucket.bucket}`,
          interpolate`arn:aws:s3:::${bucket.bucket.bucket}/*`,
        ],
      },
    ],
  }),
})

const bucketEntity = makeEntityOutput({
  entity: s3.bucketEntity,
  identity: stateId,
  meta: {
    title: bucket.bucket.bucket,
  },
  value: {
    name: bucket.bucket.bucket,
    endpoints: inputs.connection.endpoints,
    region: inputs.connection.region,
    credentials: {
      accessKey: serviceAccount.serviceAccount.accessKey,
      secretKey: serviceAccount.serviceAccount.secretKey,
    },
  },
})

export default outputs({
  bucket: bucketEntity,

  $statusFields: {
    accessKey: serviceAccount.serviceAccount.accessKey,
  },
})

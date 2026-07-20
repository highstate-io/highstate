import { rustfs, s3 } from "@highstate/library"
import { forUnit, interpolate, makeEntityOutput, makeSecretOutput, output } from "@highstate/pulumi"
import { Bucket, ServiceAccount } from "../shared"

const { stateId, args, inputs, name, outputs } = forUnit(rustfs.bucket)
const bucket = new Bucket("bucket", {
  connection: inputs.connection,
  name: args.bucketName ?? name,
})

const serviceAccount = new ServiceAccount("service-account", {
  connection: inputs.connection,
  user: inputs.connection.credentials.accessKey,
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

export default outputs({
  bucket: makeEntityOutput({
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
        accessKey: makeSecretOutput(serviceAccount.serviceAccount.accessKey),
        secretKey: makeSecretOutput(serviceAccount.serviceAccount.secretKey),
      },
    },
  }),

  $statusFields: {
    accessKey: serviceAccount.serviceAccount.accessKey,
  },
})

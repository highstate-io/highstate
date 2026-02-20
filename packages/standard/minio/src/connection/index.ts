import { minio } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { parseEndpoints } from "@highstate/common"

const { args, inputs, secrets, outputs } = forUnit(minio.connection)

const endpoints = await parseEndpoints(args.endpoints, inputs.endpoints, 7)

export default outputs({
  connection: {
    endpoints,
    region: args.region,
    credentials: {
      username: args.username,
      password: secrets.password,
    },
  },
})

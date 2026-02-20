import { generatePassword } from "@highstate/common"
import { Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { InfluxDBDatabase } from ".."

const { name, args, getSecret, inputs, outputs } = forUnit(k8s.apps.influxdbDatabase)

const database = args.database ?? name
const username = args.username ?? database
const password = getSecret("password", generatePassword)

const namespace = inputs.namespace
  ? await Namespace.forAsync(inputs.namespace, inputs.k8sCluster)
  : Namespace.create(database, { cluster: inputs.k8sCluster })

new InfluxDBDatabase(database, {
  influxdb: inputs.influxdb,
  namespace,

  username,
  database,
  password,
})

export default outputs()

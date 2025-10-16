import { generatePassword } from "@highstate/common"
import { Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { MongoDBDatabase } from ".."

const { name, args, getSecret, inputs, outputs } = forUnit(k8s.apps.mongodbDatabase)

const database = args.database ?? name
const username = args.username ?? database
const password = getSecret("password", generatePassword)

const namespace = await Namespace.forAsync(inputs.namespace, inputs.k8sCluster)

new MongoDBDatabase(database, {
  mongodb: inputs.mongodb,
  namespace,

  username,
  database,
  password,
})

export default outputs()

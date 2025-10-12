import { generatePassword } from "@highstate/common"
import { Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { MariaDBDatabase } from ".."

const { name, args, getSecret, inputs, outputs } = forUnit(k8s.apps.mariadbDatabase)

const database = args.database ?? name
const username = args.username ?? database
const password = getSecret("password", generatePassword)

const namespace = Namespace.forAsync(inputs.namespace, inputs.k8sCluster)

new MariaDBDatabase(database, {
  mariadb: inputs.mariadb,
  namespace,

  username,
  database,
  password,
})

export default outputs()

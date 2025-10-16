import { generatePassword } from "@highstate/common"
import { Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, output, toPromise } from "@highstate/pulumi"
import { PostgreSQLDatabase } from ".."

const { name, args, getSecret, inputs, outputs } = forUnit(k8s.apps.postgresqlDatabase)

const database = args.database ?? name
const username = args.username ?? database
const password = getSecret("password", generatePassword)

const namespace = inputs.namespace
  ? await Namespace.forAsync(inputs.namespace, inputs.k8sCluster)
  : await Namespace.get(`${database}-namespace`, {
      name: await toPromise(output(inputs.postgresql).apply(p => p.metadata.namespace)),
      cluster: inputs.k8sCluster,
    })

new PostgreSQLDatabase(database, {
  postgresql: inputs.postgresql,
  namespace,

  username,
  database,
  password,
})

export default outputs()

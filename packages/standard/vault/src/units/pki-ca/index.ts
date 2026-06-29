import { vault } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { PkiCa } from "../../shared"

const { name, args, inputs, outputs } = forUnit(vault.pkiCa)

const path = args.path ?? `pki/${name}`
const intermediate = args.intermediate

const ca = new PkiCa(name, {
  connection: inputs.connection,
  path,
  commonName: args.commonName ?? `${name} Root CA`,
  ttl: args.ttl,
  privateKey: args.privateKey,
  defaultLeaseTtlSeconds: args.defaultLeaseTtlSeconds,
  maxLeaseTtlSeconds: args.maxLeaseTtlSeconds,
  intermediate: {
    path: intermediate.path ?? `${path}-intermediate`,
    commonName: intermediate.commonName ?? `${name} Intermediate CA`,
    ttl: intermediate.ttl,
    privateKey: intermediate.privateKey,
    defaultLeaseTtlSeconds: intermediate.defaultLeaseTtlSeconds,
    maxLeaseTtlSeconds: intermediate.maxLeaseTtlSeconds,
  },
})

export default outputs({
  ca: ca.entity,
})

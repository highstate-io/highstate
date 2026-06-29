import { vault } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { PkiIssuer } from "../../shared"

const { name, args, inputs, outputs } = forUnit(vault.pkiIssuer)

const roleName = args.roleName ?? name

const issuer = new PkiIssuer(name, {
  ca: inputs.ca,
  roleName,
  dnsNames: args.dnsNames,
  commonNames: args.commonNames,
  allowBareDomains: args.allowBareDomains,
  allowSubdomains: args.allowSubdomains,
  allowWildcardCertificates: args.allowWildcardCertificates,
})

export default outputs({
  issuer: issuer.entity,
})

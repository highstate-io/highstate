import { tls } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { TlsCertificate } from "../../../shared"

const { name, args, inputs, outputs } = forUnit(tls.certificate)

const certificate = new TlsCertificate(name, {
  issuer: inputs.issuer,
  commonName: args.commonName,
  dnsNames: args.dnsNames,
  privateKey: args.privateKey,
  usages: args.usages,
})

export default outputs({
  certificate: certificate.certificate,
})

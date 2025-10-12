import type { k8s } from "@highstate/library"
import type { types } from "@pulumi/kubernetes"
import { cert_manager, type types as cmTypes } from "@highstate/cert-manager"
import { getOrCreate } from "@highstate/contract"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type Inputs,
  interpolate,
  type Output,
  output,
  toPromise,
} from "@highstate/pulumi"
import { omit } from "remeda"
import { Namespace } from "./namespace"
import { Secret } from "./secret"
import { commonExtraArgs, getProvider, mapMetadata, type ScopedResourceArgs } from "./shared"

export type CertificateArgs = ScopedResourceArgs & cmTypes.input.cert_manager.v1.CertificateSpec

export type CreateOrGetCertificateArgs = CertificateArgs & {
  /**
   * The certificate entity to patch/retrieve.
   */
  existing: Input<k8s.Certificate> | undefined
}

/**
 * Represents a cert-manager Certificate resource with metadata and secret.
 */
export abstract class Certificate extends ComponentResource {
  private _secret?: Output<Secret>

  protected constructor(
    type: string,
    private readonly name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,

    /**
     * The namespace where the certificate is located.
     */
    readonly namespace: Output<Namespace>,

    /**
     * The metadata of the underlying cert-manager certificate.
     */
    readonly metadata: Output<types.output.meta.v1.ObjectMeta>,

    /**
     * The spec of the underlying cert-manager certificate.
     */
    readonly spec: Output<cmTypes.output.cert_manager.v1.CertificateSpec>,

    /**
     * The status of the underlying cert-manager certificate.
     */
    readonly status: Output<cmTypes.output.cert_manager.v1.CertificateStatus>,
  ) {
    super(type, name, args, opts)
  }

  /**
   * The cluster where the certificate is located.
   */
  get cluster(): Output<k8s.Cluster> {
    return this.namespace.cluster
  }

  /**
   * The Highstate certificate entity.
   */
  get entity(): Output<k8s.ScopedResource> {
    return output({
      type: "certificate",
      clusterId: this.cluster.id,
      clusterName: this.cluster.name,
      metadata: this.metadata,
    })
  }

  /**
   * The secret containing the certificate data.
   */
  get secret(): Output<Secret> {
    if (this._secret) {
      return this._secret
    }

    this._secret = output({
      secretName: this.spec.apply(spec => spec.secretName),
      namespace: this.namespace,
    }).apply(({ secretName, namespace }) => {
      return Secret.get(`${this.name}.secret`, {
        name: secretName,
        namespace,
      })
    })

    return this._secret
  }

  /**
   * Creates a new certificate.
   */
  static create(name: string, args: CertificateArgs, opts?: ComponentResourceOptions): Certificate {
    return new CreatedCertificate(name, args, opts)
  }

  /**
   * Creates a new certificate or patches an existing one.
   *
   * @param name The name of the resource. May not be the same as the certificate name.
   * @param args The arguments to create or patch the certificate with.
   * @param opts Optional resource options.
   */
  static createOrPatch(
    name: string,
    args: CreateOrGetCertificateArgs,
    opts?: ComponentResourceOptions,
  ): Certificate {
    if (args.existing) {
      return new CertificatePatch(name, {
        ...args,
        name: output(args.existing).metadata.name,
        namespace: Namespace.forResourceAsync(args.existing, output(args.namespace).cluster),
      })
    }

    return new CreatedCertificate(name, args, opts)
  }

  /**
   * Creates a new certificate or gets an existing one.
   *
   * @param name The name of the resource. May not be the same as the certificate name. Will not be used when existing certificate is retrieved.
   * @param args The arguments to create or get the certificate with.
   * @param opts Optional resource options.
   */
  static async createOrGet(
    name: string,
    args: CreateOrGetCertificateArgs,
    opts?: ComponentResourceOptions,
  ): Promise<Certificate> {
    if (args.existing) {
      return await Certificate.forAsync(args.existing, output(args.namespace).cluster)
    }

    return new CreatedCertificate(name, args, opts)
  }

  /**
   * Patches an existing certificate.
   *
   * Will throw an error if the certificate does not exist.
   *
   * @param name The name of the resource. May not be the same as the certificate name.
   * @param args The arguments to patch the certificate with.
   * @param opts Optional resource options.
   */
  static patch(name: string, args: CertificateArgs, opts?: ComponentResourceOptions): Certificate {
    return new CertificatePatch(name, args, opts)
  }

  /**
   * Wraps an existing cert-manager certificate.
   */
  static wrap(
    name: string,
    args: WrappedCertificateArgs,
    opts?: ComponentResourceOptions,
  ): Certificate {
    return new WrappedCertificate(name, args, opts)
  }

  /**
   * Gets an existing certificate.
   *
   * Will throw an error if the certificate does not exist.
   */
  static get(
    name: string,
    args: ExternalCertificateArgs,
    opts?: ComponentResourceOptions,
  ): Certificate {
    return new ExternalCertificate(name, args, opts)
  }

  private static readonly certificateCache = new Map<string, Certificate>()

  /**
   * Gets an existing certificate for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the certificate for.
   * @param cluster The cluster where the certificate is located.
   */
  static for(entity: k8s.Certificate, cluster: Input<k8s.Cluster>): Certificate {
    return getOrCreate(
      Certificate.certificateCache,
      `${entity.clusterName}.${entity.metadata.namespace}.${entity.metadata.name}.${entity.clusterId}`,
      name => {
        return Certificate.get(name, {
          name: entity.metadata.name,
          namespace: Namespace.forResourceAsync(entity, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing certificate for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the certificate for.
   * @param cluster The cluster where the certificate is located.
   */
  static async forAsync(
    entity: Input<k8s.Certificate>,
    cluster: Input<k8s.Cluster>,
  ): Promise<Certificate> {
    const resolvedEntity = await toPromise(entity)
    return Certificate.for(resolvedEntity, output(cluster))
  }
}

class CreatedCertificate extends Certificate {
  constructor(name: string, args: CertificateArgs, opts?: ComponentResourceOptions) {
    const certificate = output(args.namespace).cluster.apply(cluster => {
      return new cert_manager.v1.Certificate(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: omit(args, commonExtraArgs),
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:Certificate",
      name,
      args,
      opts,

      output(args.namespace),
      certificate.metadata as Output<types.output.meta.v1.ObjectMeta>,
      certificate.spec,
      certificate.status,
    )
  }
}

class CertificatePatch extends Certificate {
  constructor(name: string, args: CertificateArgs, opts?: ComponentResourceOptions) {
    const certificate = output(args.namespace).cluster.apply(cluster => {
      return new cert_manager.v1.CertificatePatch(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: omit(args, commonExtraArgs),
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:CertificatePatch",
      name,
      args,
      opts,

      output(args.namespace),
      certificate.metadata as Output<types.output.meta.v1.ObjectMeta>,
      certificate.spec,
      certificate.status,
    )
  }
}

export type WrappedCertificateArgs = {
  /**
   * The underlying cert-manager certificate to wrap.
   */
  certificate: Input<cert_manager.v1.Certificate>

  /**
   * The namespace where the certificate is located.
   */
  namespace: Input<Namespace>
}

class WrappedCertificate extends Certificate {
  constructor(name: string, args: WrappedCertificateArgs, opts?: ComponentResourceOptions) {
    super(
      "highstate:k8s:WrappedCertificate",
      name,
      args,
      opts,

      output(args.namespace),
      output(args.certificate).metadata as Output<types.output.meta.v1.ObjectMeta>,
      output(args.certificate).spec,
      output(args.certificate).status,
    )
  }
}

export type ExternalCertificateArgs = {
  /**
   * The name of the certificate to get.
   */
  name: Input<string>

  /**
   * The namespace of the certificate to get.
   */
  namespace: Input<Namespace>
}

class ExternalCertificate extends Certificate {
  constructor(name: string, args: ExternalCertificateArgs, opts?: ComponentResourceOptions) {
    const certificate = output(args.namespace).cluster.apply(cluster => {
      return cert_manager.v1.Certificate.get(
        name,
        interpolate`${output(args.namespace).metadata.name}/${args.name}`,
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:ExternalCertificate",
      name,
      args,
      opts,

      output(args.namespace),
      certificate.metadata as Output<types.output.meta.v1.ObjectMeta>,
      certificate.spec,
      certificate.status,
    )
  }
}

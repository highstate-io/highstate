import type { Input } from "@highstate/pulumi"
import { createHash } from "node:crypto"
import { Deployment, type DeploymentArgs, type Namespace, type Secret } from "@highstate/k8s"

type RuntimeDeploymentArgs = {
  name: string
  namespace: Namespace
  runtime: Secret
  claimName: Input<string>
  image: string
  dockerImage: string
  publicUrl: string
  maintenance: boolean
  route?: DeploymentArgs["route"]
}

/** Keeps bind-mount paths and daemon lifecycle aligned with the local Docker backends. */
export function createRuntimeDeployment(args: RuntimeDeploymentArgs) {
  const dockerHost = "unix:///run/highstate-docker/docker.sock"
  const sharedMounts = [
    { name: "data", mountPath: "/data" },
    { name: "worker-api", mountPath: "/run/user/0" },
    { name: "docker-socket", mountPath: "/run/highstate-docker" },
    // DinD mounts a tmpfs over /tmp unless /tmp itself is already a mountpoint.
    { name: "runtime-scripts", mountPath: "/tmp" },
  ]
  return Deployment.create(args.name, {
    namespace: args.namespace,
    replicas: args.maintenance ? 0 : 1,
    strategy: { type: "Recreate" },
    container: {
      name: "highstate",
      image: args.image,
      port: { name: "http", containerPort: 3000 },
      securityContext: { runAsUser: 0, seccompProfile: { type: "Unconfined" } },
      environment: {
        HIGHSTATE_AUTH_MODE: "hosted",
        HIGHSTATE_PUBLIC_URL: args.publicUrl,
        HIGHSTATE_AUTH_PROVIDERS_FILE: "/recovery/providers.json",
        HIGHSTATE_AUTH_INITIAL_ADMINS_PATH: "/recovery/initial-admins.json",
        HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH: "/recovery/backend-identity",
        HIGHSTATE_BACKEND_DATABASE_TYPE: "postgresql",
        HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL: { secret: args.runtime, key: "postgresql-url" },
        HIGHSTATE_ENCRYPTION_ENABLED: "true",
        DOCKER_HOST: dockerHost,
        HIGHSTATE_WORKER_BACKEND_DOCKER_HOST: dockerHost,
        HIGHSTATE_TERMINAL_BACKEND_DOCKER_HOST: dockerHost,
        HIGHSTATE_RUNNER_BACKEND_LOCAL_SIDECAR_DOCKER_HOST: dockerHost,
        HIGHSTATE_RUNNER_BACKEND_LOCAL_UNSHARE_FORWARD_SIGNALS: "false",
        HIGHSTATE_LIBRARY_BACKEND_LOCAL_WORKSPACE_PATH: "/opt/highstate",
        HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_STARTUP: "false",
        HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_CHANGES: "false",
        NITRO_HOST: "0.0.0.0",
        NITRO_PORT: "3000",
      },
      volumeMounts: [...sharedMounts, { name: "recovery", mountPath: "/recovery", readOnly: true }],
      readinessProbe: { tcpSocket: { port: "http" }, periodSeconds: 5 },
      resources: { requests: { cpu: "500m", memory: "1Gi" } },
    },
    template: {
      metadata: {
        annotations: {
          "container.apparmor.security.beta.kubernetes.io/highstate": "unconfined",
          "highstate.io/runtime-config": args.runtime.stringData.apply(data =>
            createHash("sha256").update(JSON.stringify(data)).digest("hex"),
          ),
        },
      },
      spec: {
        automountServiceAccountToken: false,
        terminationGracePeriodSeconds: 120,
        // Native sidecars terminate only after the application has stopped.
        initContainers: [
          {
            name: "docker",
            image: args.dockerImage,
            restartPolicy: "Always",
            command: ["dockerd-entrypoint.sh"],
            args: [
              "dockerd",
              "--host=unix:///run/highstate-docker/docker.sock",
              "--data-root=/var/lib/docker",
            ],
            securityContext: { privileged: true, runAsUser: 0 },
            startupProbe: {
              exec: { command: ["docker", "-H", dockerHost, "info"] },
              periodSeconds: 2,
              failureThreshold: 90,
            },
            volumeMounts: [...sharedMounts, { name: "docker-data", mountPath: "/var/lib/docker" }],
            resources: { requests: { cpu: "250m", memory: "512Mi" } },
          },
        ],
        volumes: [
          { name: "data", persistentVolumeClaim: { claimName: args.claimName } },
          { name: "worker-api", emptyDir: {} },
          { name: "docker-socket", emptyDir: {} },
          { name: "docker-data", emptyDir: {} },
          { name: "runtime-scripts", emptyDir: {} },
          { name: "recovery", secret: { secretName: args.runtime.metadata.name } },
        ],
      },
    },
    route: args.route,
  })
}

import type { network, restic } from "@highstate/library"
import {
  type TriggerInvocation,
  text,
  type UnitTerminal,
  type UnitTrigger,
} from "@highstate/contract"
import {
  type Container,
  CronJob,
  createScriptContainer,
  getProvider,
  Job,
  type ScopedResourceArgs,
  ScriptBundle,
  type ScriptDistribution,
  type ScriptEnvironment,
  Secret,
  type WorkloadVolume,
} from "@highstate/k8s"
import {
  ComponentResource,
  type ComponentResourceOptions,
  getUnitInstanceName,
  type Input,
  type InputArray,
  normalize,
  type Output,
  output,
  toPromise,
} from "@highstate/pulumi"
import { batch } from "@pulumi/kubernetes"
import { join } from "remeda"
import * as images from "../assets/images.json"
import { backupEnvironment } from "./scripts"

export type BackupJobPairArgs = ScopedResourceArgs & {
  /**
   * The repository to backup/restore to/from.
   */
  resticRepo: Input<restic.Repository>

  /**
   * The key used to encrypt the backups.
   */
  backupKey: Input<string>

  /**
   * The extra script environment to pass to the backup and restore scripts.
   */
  environment?: Input<ScriptEnvironment>

  /**
   * The extra script environments to pass to the backup and restore scripts.
   */
  environments?: InputArray<ScriptEnvironment>

  /**
   * The volume to backup.
   */
  volume?: Input<WorkloadVolume>

  /**
   * The sup path of the volume to restore/backup.
   */
  subPath?: Input<string>

  /**
   * The schedule for the backup job.
   *
   * By default, the backup job runs every day at midnight.
   */
  schedule?: Input<string>

  /**
   * The extra options to pass to the restic backup command.
   */
  backupOptions?: InputArray<string>

  /**
   * The patterns to include in the backup.
   *
   * If not specified, everything is included.
   *
   * Under the hood, this adds `--exclude=!{pattern}` for each pattern.
   */
  include?: InputArray<string>

  /**
   * The patterns to exclude from the backup.
   *
   * By default, nothing is excluded.
   *
   * Under the hood, this adds `--exclude={pattern}` for each pattern.
   */
  exclude?: InputArray<string>

  /**
   * The extra options for the backup container.
   */
  backupContainer?: Input<Container>

  /**
   * The extra options for the restore container.
   */
  restoreContainer?: Input<Container>

  /**
   * The distribution to use for the scripts.
   *
   * By default, the distribution is `alpine`.
   *
   * You can also use `ubuntu` if you need to install packages that are not available (or working) in Alpine.
   */
  distribution?: ScriptDistribution

  /**
   * Extra allowed endpoints for the backup and restore jobs.
   */
  allowedEndpoints?: InputArray<network.L3Endpoint>
}

export class BackupJobPair extends ComponentResource {
  /**
   * The credentials used to access the repository and encrypt the backups.
   */
  readonly credentials: Secret

  /**
   * The script bundle used by the backup and restore jobs.
   */
  readonly scriptBundle: ScriptBundle

  /**
   * The job resource which restores the volume from the backup before creating an application.
   */
  readonly restoreJob: Job

  /**
   * The cron job resource which backups the volume regularly.
   */
  readonly backupJob: CronJob

  /**
   * The full name of the Restic repository.
   */
  readonly resticRepoPath: Output<string>

  constructor(
    private readonly name: string,
    private readonly args: BackupJobPairArgs,
    private readonly opts?: ComponentResourceOptions,
  ) {
    super("highstate:restic:BackupJobPair", name, args, opts)

    const cluster = output(args.namespace).cluster

    this.credentials = Secret.create(
      `${name}-backup-credentials`,
      {
        namespace: args.namespace,

        stringData: {
          password: args.backupKey,
          "rclone.conf": output(args.resticRepo).rcloneConfig,
        },
      },
      { ...opts, parent: this },
    )

    this.resticRepoPath = output({
      cluster,
      resticRepo: args.resticRepo,
    }).apply(({ cluster, resticRepo }) => {
      const relativePath = resticRepo.pathPattern
        .replace(/\$clusterName/g, cluster.name)
        .replace(/\$appName/g, name)
        .replace(/\$unitName/g, getUnitInstanceName())

      return `rclone:${resticRepo.remoteName}:${relativePath}`
    })

    const backupOptions = output({
      customOptions: args.backupOptions,
      include: args.include,
      exclude: args.exclude,
    }).apply(({ customOptions, include, exclude }) => [
      ...(customOptions ?? []),
      ...(include ? include.map(pattern => `--exclude=!${pattern}`) : []),
      ...(exclude ? exclude.map(pattern => `--exclude=${pattern}`) : []),
    ])

    this.scriptBundle = new ScriptBundle(
      `${name}-backup-scripts`,
      {
        namespace: args.namespace,
        distribution: args.distribution ?? "alpine",

        environments: output({
          environment: args.environment,
          environments: args.environments,
        }).apply(({ environment, environments }) => [
          backupEnvironment,
          {
            alpine: {
              packages: ["rclone"],
            },

            ubuntu: {
              preInstallPackages: ["curl", "unzip"],

              preInstallScripts: {
                "rclone.sh": text`
                  #!/bin/sh
                  set -e

                  curl https://rclone.org/install.sh | bash
                `,
              },

              allowedEndpoints: ["rclone.org:443", "downloads.rclone.org:443"],
            },

            allowedEndpoints: output({
              allowedEndpoints: args.allowedEndpoints,
              resticRepo: args.resticRepo,
            }).apply(({ allowedEndpoints, resticRepo }) => [
              ...(allowedEndpoints ?? []),
              ...(resticRepo.remoteEndpoints ?? []),
            ]),

            environment: {
              RESTIC_REPOSITORY: this.resticRepoPath,
              RESTIC_PASSWORD_FILE: "/credentials/password",
              RESTIC_HOSTNAME: "default",
              RCLONE_CONFIG: "/credentials/rclone.conf",
              EXTRA_BACKUP_OPTIONS: backupOptions.apply(join(" ")),
            },

            volumes: [
              this.credentials,
              {
                name: "credentials-temp",
                emptyDir: {},
              },
              ...(args.volume ? [args.volume] : []),
            ],

            volumeMounts: [
              {
                name: "credentials-temp",
                mountPath: "/credentials",
              },
              {
                volume: this.credentials,
                mountPath: "/credentials/rclone.conf",
                subPath: "rclone.conf",
                readOnly: true,
              },
              {
                volume: this.credentials,
                mountPath: "/credentials/password",
                subPath: "password",
                readOnly: true,
              },
              ...(args.volume
                ? [
                    {
                      volume: args.volume,
                      mountPath: "/data",
                      subPath: args.subPath,
                    },
                  ]
                : []),
            ],
          } satisfies ScriptEnvironment,
          ...normalize(environment, environments),
        ]),
      },
      { ...opts, parent: this },
    )

    this.restoreJob = Job.create(
      `${name}-restore`,
      {
        namespace: args.namespace,

        container: output(args.restoreContainer).apply(restoreContainer =>
          createScriptContainer({
            ...restoreContainer,
            main: "restore.sh",
            bundle: this.scriptBundle,
          }),
        ),

        backoffLimit: 2,
      },
      { ...opts, parent: this },
    )

    this.backupJob = CronJob.create(
      `${name}-backup`,
      {
        namespace: args.namespace,

        container: output(args.backupContainer).apply(backupContainer =>
          createScriptContainer({
            ...backupContainer,
            main: "backup.sh",
            bundle: this.scriptBundle,
          }),
        ),

        schedule: args.schedule ?? "0 0 * * *",
        concurrencyPolicy: "Forbid",

        jobTemplate: {
          spec: {
            backoffLimit: 2,
          },
        },
      },
      { ...opts, parent: this },
    )
  }

  handleTrigger(triggers: TriggerInvocation[]): UnitTrigger | undefined {
    const triggerName = `restic.backup-on-destroy.${this.name}`
    const invokedTrigger = triggers.find(trigger => trigger.name === triggerName)

    if (invokedTrigger) {
      void this.createBackupOnDestroyJob()
      return
    }

    return {
      name: triggerName,
      meta: {
        title: "Backup on Destroy",
        description: `Backup the "${this.name}" before destroying.`,
        icon: "material-symbols:backup",
      },
      spec: {
        type: "before-destroy",
      },
    }
  }

  get terminal(): Output<UnitTerminal> {
    return output({
      backupPassword: this.args.backupKey,
      resticRepo: this.args.resticRepo,
      resticRepoPath: this.resticRepoPath,
    }).apply(({ backupPassword, resticRepo, resticRepoPath }) => ({
      name: "restic",

      meta: {
        title: "Restic",
        description: "Manage Restic repository",
        icon: "material-symbols:backup",
      },

      spec: {
        image: images["terminal-restic"].image,
        command: ["bash", "/welcome.sh"],

        files: {
          "/welcome.sh": {
            meta: { name: "/welcome.sh" },
            content: {
              type: "embedded" as const,
              value: text`
                echo "Use 'restic' to manage the repository."
                echo

                exec bash
              `,
            },
          },

          "/credentials/password": {
            meta: { name: "/credentials/password" },
            content: {
              type: "embedded" as const,
              value: backupPassword,
            },
          },

          "/root/.config/rclone/rclone.conf": {
            meta: { name: "/root/.config/rclone/rclone.conf" },
            content: {
              type: "embedded" as const,
              value: resticRepo.rcloneConfig,
            },
          },
        },

        env: {
          RESTIC_REPOSITORY: resticRepoPath,
          RESTIC_PASSWORD_FILE: "/credentials/password",
        },
      },
    }))
  }

  private async createBackupOnDestroyJob(): Promise<void> {
    const cluster = await toPromise(output(this.args.namespace).cluster)

    new batch.v1.Job(
      `${this.name}-backup-on-destroy`,
      {
        metadata: {
          name: `${this.name}-backup-on-destroy`,
          namespace: this.backupJob.metadata.namespace,
        },
        spec: this.backupJob.spec.jobTemplate.spec,
      },
      { ...this.opts, parent: this, provider: getProvider(cluster) },
    )
  }
}

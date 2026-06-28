export type FeedDaemonConfigArgs = {
  statePath: string
  feedName: string
  backendName: string
  backendType: string
  syncMode: string
  pollingInterval: number
  endpoints: string[]
  enabledTunnels?: string[]
}

export function generateFeedDaemonConfigContent({
  statePath,
  feedName,
  backendName,
  backendType,
  syncMode,
  pollingInterval,
  endpoints,
  enabledTunnels = [],
}: FeedDaemonConfigArgs): string {
  return JSON.stringify(
    {
      state_path: statePath,
      feeds: {
        [feedName]: {
          sync: {
            enabled: true,
            mode: syncMode,
            polling: {
              interval: pollingInterval,
            },
            endpoints,
          },
          backends: {
            [backendName]: {
              type: backendType,
            },
          },
          tunnels: Object.fromEntries(
            enabledTunnels.map(tunnel => [
              tunnel,
              {
                enabled: true,
              },
            ]),
          ),
        },
      },
    },
    null,
    2,
  )
}

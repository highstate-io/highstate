variable "IMAGE_PREFIX" {
  default = "ghcr.io/highstate-io"
}

variable "TAGS" {
  type    = list(string)
  default = ["latest"]
}

variable "PLATFORMS" {
  type    = list(string)
  default = [BAKE_LOCAL_PLATFORM]
}

variable "CACHE_REPOSITORY" {
  default = ""
}

function "image_tags" {
  params = [name]
  result = [for tag in TAGS : "${IMAGE_PREFIX}/${name}:${tag}"]
}

function "cache_from" {
  params = [name]
  result = CACHE_REPOSITORY == "" ? [] : [
    {
      type = "registry"
      ref  = "${CACHE_REPOSITORY}:${name}"
    }
  ]
}

function "cache_to" {
  params = [name]
  result = CACHE_REPOSITORY == "" ? [] : [
    {
      type = "registry"
      ref  = "${CACHE_REPOSITORY}:${name}"
      mode = "max"
    }
  ]
}

group "images" {
  targets = [
    "core-terminal-base",
    "core-terminal-kubectl",
    "core-terminal-restic",
    "core-terminal-ssh",
    "core-terminal-talosctl",
    "core-worker-k8s-monitor",
    "core-worker-k8s-dashboard",
    "apps-exetrouter",
  ]
}

target "_common" {
  platforms = PLATFORMS
  labels = {
    "org.opencontainers.image.source" = "https://github.com/highstate-io/highstate"
  }
}

target "apps-exetrouter" {
  inherits   = ["_common"]
  context    = "docker/apps/exetrouter"
  dockerfile = "Dockerfile"
  tags       = image_tags("apps/exetrouter")
  cache-from = cache_from("exetrouter")
  cache-to   = cache_to("exetrouter")
}

target "core-terminal-base" {
  inherits   = ["_common"]
  context    = "docker/core"
  dockerfile = "terminal.base.dockerfile"
  tags       = image_tags("terminal.base")
  cache-from = cache_from("terminal-base")
  cache-to   = cache_to("terminal-base")
}

target "core-terminal-kubectl" {
  inherits   = ["_common"]
  context    = "docker/core"
  dockerfile = "terminal.kubectl.dockerfile"
  contexts = {
    terminal-base = "target:core-terminal-base"
  }
  tags       = image_tags("terminal.kubectl")
  cache-from = cache_from("terminal-kubectl")
  cache-to   = cache_to("terminal-kubectl")
}

target "core-terminal-restic" {
  inherits   = ["_common"]
  context    = "docker/core"
  dockerfile = "terminal.restic.dockerfile"
  contexts = {
    terminal-base = "target:core-terminal-base"
  }
  tags       = image_tags("terminal.restic")
  cache-from = cache_from("terminal-restic")
  cache-to   = cache_to("terminal-restic")
}

target "core-terminal-ssh" {
  inherits   = ["_common"]
  context    = "docker/core"
  dockerfile = "terminal.ssh.dockerfile"
  contexts = {
    terminal-base = "target:core-terminal-base"
  }
  tags       = image_tags("terminal.ssh")
  cache-from = cache_from("terminal-ssh")
  cache-to   = cache_to("terminal-ssh")
}

target "core-terminal-talosctl" {
  inherits   = ["_common"]
  context    = "docker/core"
  dockerfile = "terminal.talosctl.dockerfile"
  contexts = {
    terminal-kubectl = "target:core-terminal-kubectl"
  }
  tags       = image_tags("terminal.talosctl")
  cache-from = cache_from("terminal-talosctl")
  cache-to   = cache_to("terminal-talosctl")
}

target "core-worker-k8s-monitor" {
  inherits   = ["_common"]
  context    = "packages/standard/k8s.monitor-worker"
  dockerfile = "../../../docker/core/worker.k8s-monitor.dockerfile"
  tags       = image_tags("worker.k8s-monitor")
  cache-from = cache_from("worker-k8s-monitor")
  cache-to   = cache_to("worker-k8s-monitor")
}

target "core-worker-k8s-dashboard" {
  inherits   = ["_common"]
  context    = "packages/standard/k8s.dashboard-worker"
  dockerfile = "../../../docker/core/worker.k8s-dashboard.dockerfile"
  tags       = image_tags("worker.k8s-dashboard")
  cache-from = cache_from("worker-k8s-dashboard")
  cache-to   = cache_to("worker-k8s-dashboard")
}

# compatibility aliases for the trusted preview selector on main
target "terminal-base" {
  inherits = ["core-terminal-base"]
}

target "terminal-kubectl" {
  inherits = ["core-terminal-kubectl"]
}

target "terminal-restic" {
  inherits = ["core-terminal-restic"]
}

target "terminal-ssh" {
  inherits = ["core-terminal-ssh"]
}

target "terminal-talosctl" {
  inherits = ["core-terminal-talosctl"]
}

target "worker-k8s-monitor" {
  inherits = ["core-worker-k8s-monitor"]
}

target "worker-k8s-dashboard" {
  inherits = ["core-worker-k8s-dashboard"]
}

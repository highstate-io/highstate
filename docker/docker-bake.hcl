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
    "terminal-base",
    "terminal-kubectl",
    "terminal-restic",
    "terminal-ssh",
    "terminal-talosctl",
    "worker-k8s-monitor",
    "worker-k8s-dashboard",
  ]
}

target "_common" {
  platforms = PLATFORMS
  labels = {
    "org.opencontainers.image.source" = "https://github.com/highstate-io/highstate"
  }
}

target "terminal-base" {
  inherits   = ["_common"]
  context    = "docker"
  dockerfile = "terminal.base.dockerfile"
  tags       = image_tags("terminal.base")
  cache-from = cache_from("terminal-base")
  cache-to   = cache_to("terminal-base")
}

target "terminal-kubectl" {
  inherits   = ["_common"]
  context    = "docker"
  dockerfile = "terminal.kubectl.dockerfile"
  contexts = {
    terminal-base = "target:terminal-base"
  }
  tags       = image_tags("terminal.kubectl")
  cache-from = cache_from("terminal-kubectl")
  cache-to   = cache_to("terminal-kubectl")
}

target "terminal-restic" {
  inherits   = ["_common"]
  context    = "docker"
  dockerfile = "terminal.restic.dockerfile"
  contexts = {
    terminal-base = "target:terminal-base"
  }
  tags       = image_tags("terminal.restic")
  cache-from = cache_from("terminal-restic")
  cache-to   = cache_to("terminal-restic")
}

target "terminal-ssh" {
  inherits   = ["_common"]
  context    = "docker"
  dockerfile = "terminal.ssh.dockerfile"
  contexts = {
    terminal-base = "target:terminal-base"
  }
  tags       = image_tags("terminal.ssh")
  cache-from = cache_from("terminal-ssh")
  cache-to   = cache_to("terminal-ssh")
}

target "terminal-talosctl" {
  inherits   = ["_common"]
  context    = "docker"
  dockerfile = "terminal.talosctl.dockerfile"
  contexts = {
    terminal-kubectl = "target:terminal-kubectl"
  }
  tags       = image_tags("terminal.talosctl")
  cache-from = cache_from("terminal-talosctl")
  cache-to   = cache_to("terminal-talosctl")
}

target "worker-k8s-monitor" {
  inherits   = ["_common"]
  context    = "packages/standard/k8s.monitor-worker"
  dockerfile = "Dockerfile"
  tags       = image_tags("worker.k8s-monitor")
  cache-from = cache_from("worker-k8s-monitor")
  cache-to   = cache_to("worker-k8s-monitor")
}

target "worker-k8s-dashboard" {
  inherits   = ["_common"]
  context    = "packages/standard/k8s.dashboard-worker"
  dockerfile = "Dockerfile"
  tags       = image_tags("worker.k8s-dashboard")
  cache-from = cache_from("worker-k8s-dashboard")
  cache-to   = cache_to("worker-k8s-dashboard")
}

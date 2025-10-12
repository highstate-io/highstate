import { proxmox, distributions } from "@highstate/library"

// connection to Proxmox
const { proxmoxCluster } = proxmox.connection({
  name: "my-proxmox",
  args: {
    endpoint: "https://192.168.1.100:8006",
    insecure: true,
    username: "root@pam",
  },
})

// Ubuntu distribution provides the image URL
const { image: ubuntuImage } = distributions.ubuntu({
  name: "ubuntu-22-04",
})

// upload the Ubuntu image to Proxmox
proxmox.image({
  name: "ubuntu-image",
  inputs: {
    proxmoxCluster,
    file: ubuntuImage,
  },
})
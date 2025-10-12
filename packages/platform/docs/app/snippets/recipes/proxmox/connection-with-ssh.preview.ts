import { proxmox, ssh } from "@highstate/library"

// SSH key pair for accessing the Proxmox host
const { keyPair } = ssh.keyPair({
  name: "ssh-key",
})

// connection with SSH access for terminal support
proxmox.connection({
  name: "my-proxmox",
  args: {
    endpoint: "https://192.168.1.100:8006",
    insecure: true,
    username: "root@pam",
    ssh: {
      user: "root",
      port: 22,
    },
  },
  inputs: {
    sshKeyPair: keyPair,
  },
})
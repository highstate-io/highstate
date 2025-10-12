import { proxmox, distributions, ssh, k3s, k8s } from "@highstate/library"

// SSH key for all VMs
const { keyPair } = ssh.keyPair({
  name: "cluster-ssh-key",
})

// Proxmox connection
const { proxmoxCluster } = proxmox.connection({
  name: "proxmox",
  args: {
    endpoint: "https://192.168.1.100:8006",
    insecure: true,
    username: "root@pam",
  },
  inputs: {
    sshKeyPair: keyPair,
  },
})

// Ubuntu for all VMs
const { image: ubuntuImage, cloudConfig } = distributions.ubuntu({
  name: "ubuntu",
  args: {
    version: "22.04",
  },
})

// Upload Ubuntu image
const { image } = proxmox.image({
  name: "ubuntu-image",
  inputs: {
    proxmoxCluster,
    file: ubuntuImage,
  },
})

// Control plane VM
const { server: controlPlane } = proxmox.virtualMachine({
  name: "k3s-control",
  args: {
    resources: {
      cores: 2,
      memory: 4096,
      diskSize: 30,
    },
    ipv4: {
      type: "static",
      address: "192.168.1.210",
      prefix: 24,
    },
  },
  inputs: {
    proxmoxCluster,
    image,
    vendorData: cloudConfig,
    sshKeyPair: keyPair,
  },
})

// Worker node 1
const { server: worker1 } = proxmox.virtualMachine({
  name: "k3s-worker-1",
  args: {
    resources: {
      cores: 2,
      memory: 2048,
      diskSize: 20,
    },
    ipv4: {
      type: "static",
      address: "192.168.1.211",
      prefix: 24,
    },
  },
  inputs: {
    proxmoxCluster,
    image,
    vendorData: cloudConfig,
    sshKeyPair: keyPair,
  },
})

// Worker node 2
const { server: worker2 } = proxmox.virtualMachine({
  name: "k3s-worker-2",
  args: {
    resources: {
      cores: 2,
      memory: 2048,
      diskSize: 20,
    },
    ipv4: {
      type: "static",
      address: "192.168.1.212",
      prefix: 24,
    },
  },
  inputs: {
    proxmoxCluster,
    image,
    vendorData: cloudConfig,
    sshKeyPair: keyPair,
  },
})

// Create k3s cluster on the VMs
const { k8sCluster } = k3s.cluster({
  name: "k3s-cluster",
  inputs: {
    masters: [controlPlane],
    workers: [worker1, worker2],
  },
})

// Deploy MariaDB on the cluster
k8s.apps.mariadb({
  name: "mariadb",
  inputs: {
    k8sCluster,
  },
})
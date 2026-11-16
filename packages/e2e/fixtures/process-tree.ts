if (process.argv[2] === "child") {
  process.send?.("ready")
  setInterval(() => {}, 1000)
} else {
  const child = Bun.spawn([process.execPath, import.meta.path, "child"], {
    stdout: "inherit",
    stderr: "inherit",
    ipc(message) {
      if (message === "ready") {
        console.log("descendant ready")

        if (process.argv[2] !== "timeout") {
          process.exit(0)
        }
      }
    },
  })

  await child.exited
}

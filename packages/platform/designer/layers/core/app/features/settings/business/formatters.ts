/**
 * Formats timestamp to readable date string
 */
export const formatDate = (timestamp?: Date) => {
  if (!timestamp) return "Unknown"

  return timestamp.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Gets relative time from timestamp
 */
export const getRelativeTime = (timestamp?: Date) => {
  if (!timestamp) return "Unknown"

  const now = Date.now()
  const diff = now - timestamp.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor(diff / (1000 * 60))

  if (days > 0) {
    return `${days} day${days === 1 ? "" : "s"} ago`
  } else if (hours > 0) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`
  } else if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  } else {
    return "Just now"
  }
}

/**
 * Formats ID to short version for display
 */
export const formatShortId = (id: string) => {
  return `${id.slice(0, 8)}...${id.slice(-8)}`
}

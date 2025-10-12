export function getTextColorByBackgroundColor(backgroundColor: string): string {
  const hex = backgroundColor.replace("#", "")
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 2), 16)
  const b = parseInt(hex.substring(4, 2), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 128 ? "#000" : "#fff"
}

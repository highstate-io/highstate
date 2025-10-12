import type { BlueprintStatus } from "#layers/core/app/features/blueprint"

export function getNodeCardStyle(
  selected: boolean | undefined,
  blueprintStatus: BlueprintStatus | undefined,
) {
  const baseStyle = {
    borderRadius: "4px",
    overflow: "visible",
  }

  switch (blueprintStatus) {
    case "blueprint-valid":
      return {
        ...baseStyle,
        opacity: "0.7",
        outline: "2px solid #4CAF50",
        backgroundColor: "rgba(76, 175, 80, 0.1)",
        boxShadow: "0 0 10px rgba(76, 175, 80, 0.3)",
      }
    case "blueprint-invalid":
      return {
        ...baseStyle,
        opacity: "0.7",
        outline: "2px solid #F44336",
        backgroundColor: "rgba(244, 67, 54, 0.1)",
        boxShadow: "0 0 10px rgba(244, 67, 54, 0.3)",
      }
  }

  if (selected) {
    return {
      ...baseStyle,
      outline: "2px solid #2196F3",
      boxShadow: "0 0 8px rgba(33, 150, 243, 0.4)",
    }
  }

  return baseStyle
}

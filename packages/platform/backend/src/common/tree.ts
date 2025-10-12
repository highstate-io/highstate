export type TreeNode = {
  text: string
  children: TreeNode[]
}

/**
 * Renders a tree structure similar to the Linux tree command output.
 * Uses box-drawing characters to create visual hierarchy.
 */
export function renderTree(node: TreeNode): string {
  const lines: string[] = []

  function renderNode(node: TreeNode, prefix: string = "", isLast: boolean = true): void {
    // Add current node
    lines.push(prefix + (isLast ? "└── " : "├── ") + node.text)

    // Add children
    const childPrefix = prefix + (isLast ? "    " : "│   ")
    node.children.forEach((child, index) => {
      const isLastChild = index === node.children.length - 1
      renderNode(child, childPrefix, isLastChild)
    })
  }

  // Start with root node (no prefix)
  lines.push(node.text)
  node.children.forEach((child, index) => {
    const isLastChild = index === node.children.length - 1
    renderNode(child, "", isLastChild)
  })

  return lines.join("\n")
}

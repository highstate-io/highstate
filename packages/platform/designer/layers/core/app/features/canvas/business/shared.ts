/**
 * The indicator of the current cursor mode.
 *
 * - `default`: The default cursor mode, typically used for normal interactions.
 * - `selection`: The cursor is now drawing selection/deselection areas.
 * - `blueprint`: The cursor is now placing a blueprint.
 * - `movement`: The cursor is now moving selected nodes.
 */
export type CursorMode = "default" | "selection" | "blueprint" | "movement"

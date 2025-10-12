import type { Stream } from "node:stream"
import type { TerminalSpec } from "@highstate/contract"

export type ScreenSize = {
  /**
   * The number of columns.
   */
  cols: number

  /**
   * The number of rows.
   */
  rows: number
}

export type TerminalRunOptions = {
  /**
   * The terminal spec to use.
   */
  spec: TerminalSpec

  /**
   * The input stream.
   */
  stdin: Stream

  /**
   * The output stream.
   */
  stdout: NodeJS.WritableStream

  /**
   * The size of the screen to set before running the terminal.
   */
  screenSize: ScreenSize

  /**
   * The signal to abort the terminal.
   */
  signal?: AbortSignal
}

export interface TerminalBackend {
  /**
   * Creates a new terminal and runs it.
   *
   * @param options The options.
   */
  run(options: TerminalRunOptions): Promise<void>
}

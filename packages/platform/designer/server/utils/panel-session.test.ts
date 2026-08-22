import { afterEach, describe, expect, test, vi } from "vitest"
import {
  createPanelLaunchTicket,
  exchangePanelLaunchTicket,
  getActivePanelSession,
  getPanelIdFromHost,
  getPanelSession,
} from "./panel-session"

afterEach(() => vi.useRealTimers())

describe("panel host utilities", () => {
  test("gets panel IDs from base and nested panel hosts", () => {
    expect(getPanelIdFromHost("panel123.panels.highstate.localhost:7283")).toBe("panel123")
    expect(getPanelIdFromHost("1785193731913.panel123.panels.highstate.localhost:7283")).toBe(
      "panel123",
    )
  })

  test("rejects unrelated hosts", () => {
    expect(getPanelIdFromHost("highstate.localhost:7283")).toBeUndefined()
    expect(getPanelIdFromHost("panel123.panels.example.com:7283")).toBeUndefined()
  })

  test("finds an active session for authenticated nested-host streams", () => {
    const ticket = createPanelLaunchTicket("project123", "panel123", "instance123")
    expect(exchangePanelLaunchTicket(ticket, "panel123")).toBeDefined()

    expect(getActivePanelSession("panel123")).toMatchObject({
      projectId: "project123",
      panelId: "panel123",
      workerInstanceId: "instance123",
    })
  })
})

describe("panel launch sessions", () => {
  test("pins each launch to its worker instance", () => {
    const firstTicket = createPanelLaunchTicket("project-pools", "panel-pools", "instance-a")
    const firstSessionId = exchangePanelLaunchTicket(firstTicket, "panel-pools")!
    expect(getPanelSession(firstSessionId, "panel-pools")?.workerInstanceId).toBe("instance-a")

    const secondTicket = createPanelLaunchTicket("project-pools", "panel-pools", "instance-b")
    const secondSessionId = exchangePanelLaunchTicket(secondTicket, "panel-pools")!
    expect(getPanelSession(secondSessionId, "panel-pools")?.workerInstanceId).toBe("instance-b")
    expect(getPanelSession(firstSessionId, "panel-pools")).toBeUndefined()
    expect(getActivePanelSession("panel-pools")?.workerInstanceId).toBe("instance-b")
    expect(exchangePanelLaunchTicket(secondTicket, "panel-pools")).toBeUndefined()
  })

  test("removes older sessions only for the relaunched panel", () => {
    const conflictA = exchangePanelLaunchTicket(
      createPanelLaunchTicket("project-a", "panel-conflict", "instance-a"),
      "panel-conflict",
    )!
    const otherPanelA = exchangePanelLaunchTicket(
      createPanelLaunchTicket("project-a", "panel-other", "instance-a"),
      "panel-other",
    )!
    const otherPanelB = exchangePanelLaunchTicket(
      createPanelLaunchTicket("project-b", "panel-b", "instance-b"),
      "panel-b",
    )!
    const conflictB = exchangePanelLaunchTicket(
      createPanelLaunchTicket("project-b", "panel-conflict", "instance-b"),
      "panel-conflict",
    )!

    expect(getPanelSession(conflictA, "panel-conflict")).toBeUndefined()
    expect(getPanelSession(conflictB, "panel-conflict")?.projectId).toBe("project-b")
    expect(getPanelSession(otherPanelA, "panel-other")?.projectId).toBe("project-a")
    expect(getPanelSession(otherPanelB, "panel-b")?.projectId).toBe("project-b")
  })

  test("does not expose an expired session or its pool", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const sessionId = exchangePanelLaunchTicket(
      createPanelLaunchTicket("project-expiry", "panel-expiry", "instance-expiry"),
      "panel-expiry",
    )!
    expect(getPanelSession(sessionId, "panel-expiry")?.workerInstanceId).toBe("instance-expiry")

    vi.advanceTimersByTime(8 * 60 * 60 * 1_000 + 1)
    expect(getPanelSession(sessionId, "panel-expiry")).toBeUndefined()
    expect(getActivePanelSession("panel-expiry")).toBeUndefined()
  })
})

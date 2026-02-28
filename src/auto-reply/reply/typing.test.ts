import { describe, expect, it, vi } from "vitest";
import { createTypingController } from "./typing.js";

describe("createTypingController absolute max duration", () => {
  it("blocks TTL refreshes after deadline; last soft TTL expires naturally", async () => {
    vi.useFakeTimers();
    try {
      const onReplyStart = vi.fn().mockResolvedValue(undefined);
      const onCleanup = vi.fn();
      const log = vi.fn();

      const controller = createTypingController({
        onReplyStart,
        onCleanup,
        typingTtlMs: 10_000,
        maxAbsoluteDurationMs: 30_000,
        log,
      });

      // t=0: start typing. Soft TTL = t+10s. Deadline = t+30s.
      await controller.startTypingLoop();
      expect(controller.isActive()).toBe(true);

      // Refresh every 5s — keeps pushing the soft TTL forward
      for (let i = 1; i <= 5; i++) {
        await vi.advanceTimersByTimeAsync(5_000);
        controller.refreshTypingTtl();
      }
      // t=25s: last successful refresh → soft TTL set to t=35s
      expect(controller.isActive()).toBe(true);

      // t=30s: refresh is blocked (past deadline)
      await vi.advanceTimersByTimeAsync(5_000);
      controller.refreshTypingTtl();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("TTL refresh blocked"));
      // Still active — waiting for the last soft TTL to expire at t=35s
      expect(controller.isActive()).toBe(true);

      // t=35s: last soft TTL fires → cleanup
      await vi.advanceTimersByTimeAsync(5_000);
      expect(controller.isActive()).toBe(false);
      expect(onCleanup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("normal cleanup before deadline still works", async () => {
    vi.useFakeTimers();
    try {
      const onReplyStart = vi.fn().mockResolvedValue(undefined);
      const onCleanup = vi.fn();
      const log = vi.fn();

      const controller = createTypingController({
        onReplyStart,
        onCleanup,
        maxAbsoluteDurationMs: 60_000,
        log,
      });

      await controller.startTypingLoop();
      expect(controller.isActive()).toBe(true);

      // Normal lifecycle: run completes and dispatch goes idle well before deadline
      await vi.advanceTimersByTimeAsync(5_000);
      controller.markRunComplete();
      controller.markDispatchIdle();

      expect(controller.isActive()).toBe(false);
      expect(onCleanup).toHaveBeenCalledTimes(1);

      // Advance past what would have been the deadline — no double-cleanup
      await vi.advanceTimersByTimeAsync(120_000);
      expect(onCleanup).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining("TTL refresh blocked"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("explicit cleanup() seals controller; no late TTL effects", async () => {
    vi.useFakeTimers();
    try {
      const onReplyStart = vi.fn().mockResolvedValue(undefined);
      const onCleanup = vi.fn();
      const log = vi.fn();

      const controller = createTypingController({
        onReplyStart,
        onCleanup,
        typingTtlMs: 10_000,
        maxAbsoluteDurationMs: 60_000,
        log,
      });

      await controller.startTypingLoop();
      expect(controller.isActive()).toBe(true);

      // Explicit cleanup at t=5s
      await vi.advanceTimersByTimeAsync(5_000);
      controller.cleanup();
      expect(controller.isActive()).toBe(false);
      expect(onCleanup).toHaveBeenCalledTimes(1);

      // Advance past original soft TTL and deadline — sealed, nothing fires
      await vi.advanceTimersByTimeAsync(120_000);
      expect(onCleanup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("defaults to 5-minute deadline", async () => {
    vi.useFakeTimers();
    try {
      const onReplyStart = vi.fn().mockResolvedValue(undefined);
      const onCleanup = vi.fn();
      const log = vi.fn();

      const controller = createTypingController({
        onReplyStart,
        onCleanup,
        typingTtlMs: 30_000,
        log,
      });

      await controller.startTypingLoop();

      // Refresh every 10s for ~5 minutes
      for (let i = 1; i <= 29; i++) {
        await vi.advanceTimersByTimeAsync(10_000);
        controller.refreshTypingTtl();
      }
      // t=290s: last successful refresh → soft TTL = t+30s = 320s
      expect(controller.isActive()).toBe(true);

      // t=300s (5min): refresh blocked
      await vi.advanceTimersByTimeAsync(10_000);
      controller.refreshTypingTtl();
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("absolute max duration reached (5m)"),
      );
      expect(controller.isActive()).toBe(true);

      // t=320s: last soft TTL expires → cleanup
      await vi.advanceTimersByTimeAsync(20_000);
      expect(controller.isActive()).toBe(false);
      expect(onCleanup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables deadline when maxAbsoluteDurationMs is 0", async () => {
    vi.useFakeTimers();
    try {
      const onReplyStart = vi.fn().mockResolvedValue(undefined);
      const onCleanup = vi.fn();

      const controller = createTypingController({
        onReplyStart,
        onCleanup,
        typingTtlMs: 10 * 60_000,
        maxAbsoluteDurationMs: 0,
      });

      await controller.startTypingLoop();

      // Refresh for 10 minutes — no deadline, stays alive
      for (let i = 0; i < 120; i++) {
        await vi.advanceTimersByTimeAsync(5_000);
        controller.refreshTypingTtl();
      }
      expect(controller.isActive()).toBe(true);

      controller.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });
});

import { test, expect, describe, beforeEach } from "bun:test";
import { TelegramInterfaceAdapter } from "../../src/components/telegram-interface-adapter/telegram-interface-adapter.ts";
import type { TelegramInterfaceAdapterConfig } from "../../src/components/telegram-interface-adapter/types.ts";
import type { TelegramUpdate } from "../../src/interfaces/component-interfaces.ts";

describe("TelegramInterfaceAdapter", () => {
  let adapter: TelegramInterfaceAdapter;
  let config: TelegramInterfaceAdapterConfig;

  beforeEach(() => {
    config = {
      botToken: "test-token",
      maxMessageLength: 4096,
      rateLimits: {
        maxMessagesPerSecond: 30,
        maxMessagesPerMinute: 20,
        maxMessagesPerHour: 100
      },
      queueConfig: {
        maxQueueSize: 100,
        processingInterval: 1000,
        maxRetries: 3
      }
    };
    adapter = new TelegramInterfaceAdapter(config);
  });

  test("should create adapter with valid config", () => {
    expect(adapter).toBeDefined();
  });

  test("should get status", () => {
    const status = adapter.getStatus();
    expect(status).toBeDefined();
    expect(status.name).toBe("TelegramInterfaceAdapter");
    expect(['healthy', 'degraded', 'unhealthy']).toContain(status.status);
    expect(status.lastHealthCheck).toBeInstanceOf(Date);
  });

  test("should initialize successfully", async () => {
    await expect(adapter.initialize()).resolves.toBeUndefined();
  });

  test("should handle duplicate updates", async () => {
    await adapter.initialize();

    const update: TelegramUpdate = {
      update_id: 123,
      message: {
        message_id: 1,
        chat: { id: 12345 },
        text: "Test message",
        from: { id: 67890 },
        date: Math.floor(Date.now() / 1000)
      }
    };

    // First call should succeed
    await expect(adapter.receiveUpdate(update)).resolves.toBeDefined();

    // Second call with same update_id should throw
    await expect(adapter.receiveUpdate(update)).rejects.toThrow("Duplicate update received");
  });

  test("should send typing indicator", async () => {
    await adapter.initialize();
    await expect(adapter.sendTypingIndicator(12345)).resolves.toBeUndefined();
  });
});
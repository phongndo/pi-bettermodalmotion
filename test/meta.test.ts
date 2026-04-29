import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";

import betterModalMotionExtension, {
  BETTER_MODAL_MOTION_EXTENSION_STAGE,
  BETTER_MODAL_MOTION_NEXT_STEPS,
} from "../src/index.js";

type CapturedHandler = (event: unknown, ctx: unknown) => unknown;

describe("extension entrypoint", () => {
  it("marks the extension as a modal input core", () => {
    expect(BETTER_MODAL_MOTION_EXTENSION_STAGE).toBe("modal-input-core");
  });

  it("keeps the next planned steps documented in code", () => {
    expect(BETTER_MODAL_MOTION_NEXT_STEPS.length).toBeGreaterThan(0);
    expect(BETTER_MODAL_MOTION_NEXT_STEPS[0]).toContain(
      "prompt-buffer operators",
    );
  });

  it("registers modal editor lifecycle hooks", () => {
    const handlers = new Map<string, CapturedHandler>();
    const pi = {
      on(event: string, handler: CapturedHandler) {
        handlers.set(event, handler);
      },
    } as unknown as ExtensionAPI;

    expect(() => {
      betterModalMotionExtension(pi);
    }).not.toThrow();

    expect([...handlers.keys()].sort()).toEqual([
      "session_shutdown",
      "session_start",
    ]);
  });

  it("installs and clears the editor component in UI sessions", () => {
    const handlers = new Map<string, CapturedHandler>();
    const pi = {
      on(event: string, handler: CapturedHandler) {
        handlers.set(event, handler);
      },
    } as unknown as ExtensionAPI;
    betterModalMotionExtension(pi);

    let editorFactory: unknown = null;
    const ctx = {
      hasUI: true,
      ui: {
        setEditorComponent(factory: unknown) {
          editorFactory = factory;
        },
      },
    };

    handlers.get("session_start")?.({}, ctx);
    expect(typeof editorFactory).toBe("function");

    handlers.get("session_shutdown")?.({}, ctx);
    expect(editorFactory).toBeUndefined();
  });

  it("does not install the editor component without UI support", () => {
    const handlers = new Map<string, CapturedHandler>();
    const pi = {
      on(event: string, handler: CapturedHandler) {
        handlers.set(event, handler);
      },
    } as unknown as ExtensionAPI;
    betterModalMotionExtension(pi);

    let calls = 0;
    const ctx = {
      hasUI: false,
      ui: {
        setEditorComponent() {
          calls += 1;
        },
      },
    };

    handlers.get("session_start")?.({}, ctx);
    handlers.get("session_shutdown")?.({}, ctx);

    expect(calls).toBe(0);
  });
});

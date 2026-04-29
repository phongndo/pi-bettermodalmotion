import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { BetterModalMotionEditor } from "./editor/modal-motion-editor.js";

export const BETTER_MODAL_MOTION_EXTENSION_STAGE = "modal-input-core" as const;

export const BETTER_MODAL_MOTION_NEXT_STEPS = [
  "Keep polishing prompt-buffer operators and cursor semantics against real pi usage.",
  "Add configuration for keymaps, mode colors, startup mode, and reserved bindings.",
  "Wait for native pi scrollback hooks before attempting chat visual mode.",
] as const;

export default function betterModalMotionExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new BetterModalMotionEditor(
        tui,
        theme,
        keybindings,
        (text, mode) =>
          mode === "insert"
            ? ctx.ui.theme.fg("warning", text)
            : ctx.ui.theme.fg("text", text),
      );

      queueMicrotask(() => {
        editor.borderColor = ctx.ui.theme.getThinkingBorderColor(
          pi.getThinkingLevel(),
        );
        tui.requestRender();
      });

      return editor;
    });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setEditorComponent(undefined);
  });
}

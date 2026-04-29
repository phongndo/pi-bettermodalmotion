import { matchesKey, visibleWidth, type KeyId } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";

import type { KeybindingsManager } from "@mariozechner/pi-coding-agent";

import {
  BetterModalMotionEditor,
  buildModeBorderLine,
  getLegacyEscapeSuffixKey,
  getModalKey,
  getModeLabel,
  isTextInputData,
} from "../src/editor/modal-motion-editor.js";

const DEFAULT_KEY_BINDINGS: Record<string, KeyId | KeyId[]> = {
  "app.clipboard.pasteImage": "ctrl+v",
  "app.interrupt": "escape",
  "app.exit": "ctrl+d",
  "app.clear": "ctrl+c",
  "app.suspend": "ctrl+z",
  "app.thinking.cycle": "shift+tab",
  "app.model.cycleForward": "ctrl+p",
  "app.model.cycleBackward": "shift+ctrl+p",
  "app.model.select": "ctrl+l",
  "app.tools.expand": "ctrl+o",
  "app.thinking.toggle": "ctrl+t",
  "app.editor.external": "ctrl+g",
  "app.message.followUp": "alt+enter",
  "app.message.dequeue": "alt+up",
};

function createFakeKeybindings(): KeybindingsManager {
  return {
    matches(data: string, keybinding: string): boolean {
      const keys = DEFAULT_KEY_BINDINGS[keybinding];
      const keyList = Array.isArray(keys) ? keys : keys ? [keys] : [];
      return keyList.some((key) => matchesKey(data, key));
    },
    getKeys(keybinding: string): KeyId[] {
      const keys = DEFAULT_KEY_BINDINGS[keybinding];
      return Array.isArray(keys) ? [...keys] : keys ? [keys] : [];
    },
  } as unknown as KeybindingsManager;
}

function createEditor(text = ""): BetterModalMotionEditor {
  const tui = {
    terminal: { rows: 24, columns: 80 },
    requestRender() {},
  };
  const theme = {
    borderColor: (value: string) => value,
    selectList: {},
  };
  const editor = new BetterModalMotionEditor(
    tui as ConstructorParameters<typeof BetterModalMotionEditor>[0],
    theme as ConstructorParameters<typeof BetterModalMotionEditor>[1],
    createFakeKeybindings(),
  );
  if (text) editor.setText(text);
  return editor;
}

describe("modal motion editor helpers", () => {
  it("normalizes raw terminal input into modal keys", () => {
    expect(getModalKey("h")).toBe("h");
    expect(getModalKey(" ")).toBe(" ");
    expect(getModalKey("\x1b")).toBe("escape");
    expect(getModalKey("\x1b[D")).toBe("left");
  });

  it("detects fast legacy escape-plus-key chords", () => {
    expect(getLegacyEscapeSuffixKey("\x1bh")).toBe("h");
    expect(getLegacyEscapeSuffixKey("\x1b[D")).toBeUndefined();
    expect(getLegacyEscapeSuffixKey("h")).toBeUndefined();
  });

  it("identifies textual input that normal mode should ignore", () => {
    expect(isTextInputData("x")).toBe(true);
    expect(isTextInputData("pasted text")).toBe(true);
    expect(isTextInputData("\x1b[200~paste\x1b[201~")).toBe(true);
    expect(isTextInputData("\x03")).toBe(false);
    expect(isTextInputData("\x1b[D")).toBe(false);
  });

  it("labels editor modes", () => {
    expect(getModeLabel("normal")).toBe("NORMAL");
    expect(getModeLabel("insert")).toBe("INSERT");
    expect(getModeLabel("operator-pending")).toBe("OPERATOR");
  });

  it("renders a width-safe top border with a styled mode label", () => {
    const line = buildModeBorderLine(
      24,
      "normal",
      (text) => text,
      (text) => `\x1b[1m${text}\x1b[22m`,
    );

    expect(line).toContain("NORMAL");
    expect(visibleWidth(line)).toBe(24);
  });

  it("truncates the mode border for narrow editors", () => {
    const line = buildModeBorderLine(5, "insert", (text) => text);

    expect(visibleWidth(line)).toBeLessThanOrEqual(5);
    expect(line).toContain("── IN");
  });
});

describe("BetterModalMotionEditor", () => {
  it("enters normal mode from insert mode without leaving the cursor past the last character", () => {
    const editor = createEditor("hello");

    editor.handleInput("\x1b");

    expect(editor.getMode()).toBe("normal");
    expect(editor.getCursor()).toEqual({ line: 0, col: 4 });
  });

  it("handles fast Escape plus a following motion key", () => {
    const editor = createEditor("hello");

    editor.handleInput("\x1bh");

    expect(editor.getMode()).toBe("normal");
    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it("supports word deletion with dw", () => {
    const editor = createEditor("hello world");
    editor.handleInput("\x1b");
    editor.handleInput("b");

    editor.handleInput("d");
    editor.handleInput("w");

    expect(editor.getText()).toBe("hello ");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getRegister()).toEqual({ text: "world", linewise: false });
  });

  it("supports line deletion with dd", () => {
    const editor = createEditor("one\ntwo\nthree");
    editor.handleInput("\x1b");
    editor.handleInput("g");
    editor.handleInput("g");

    editor.handleInput("d");
    editor.handleInput("d");

    expect(editor.getText()).toBe("two\nthree");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
    expect(editor.getRegister()).toEqual({ text: "one\n", linewise: true });
  });

  it("supports linewise paste with p", () => {
    const editor = createEditor("one\ntwo");
    editor.handleInput("\x1b");
    editor.handleInput("g");
    editor.handleInput("g");
    editor.handleInput("y");
    editor.handleInput("y");

    editor.handleInput("p");

    expect(editor.getText()).toBe("one\none\ntwo");
  });
});

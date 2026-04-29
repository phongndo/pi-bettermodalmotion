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

function sendKeys(
  editor: BetterModalMotionEditor,
  keys: readonly string[],
): void {
  for (const key of keys) editor.handleInput(key);
}

function enterNormalAtStart(editor: BetterModalMotionEditor): void {
  sendKeys(editor, ["\x1b", "g", "g", "0"]);
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

  it("keeps normal-mode horizontal motion inside the current line", () => {
    const editor = createEditor("a\nbc");
    sendKeys(editor, ["\x1b", "0", "h"]);

    expect(editor.getCursor()).toEqual({ line: 1, col: 0 });

    sendKeys(editor, ["l", "l"]);

    expect(editor.getCursor()).toEqual({ line: 1, col: 1 });
  });

  it("uses Vim-exclusive ranges for right and left character operators", () => {
    const deleteRight = createEditor("abc");
    enterNormalAtStart(deleteRight);
    sendKeys(deleteRight, ["d", "l"]);

    expect(deleteRight.getText()).toBe("bc");
    expect(deleteRight.getRegister()).toEqual({ text: "a", linewise: false });

    const deleteTwoRight = createEditor("abc");
    enterNormalAtStart(deleteTwoRight);
    sendKeys(deleteTwoRight, ["d", "2", "l"]);

    expect(deleteTwoRight.getText()).toBe("c");
    expect(deleteTwoRight.getRegister()).toEqual({
      text: "ab",
      linewise: false,
    });

    const deleteLeft = createEditor("abc");
    enterNormalAtStart(deleteLeft);
    sendKeys(deleteLeft, ["l", "d", "h"]);

    expect(deleteLeft.getText()).toBe("bc");
    expect(deleteLeft.getRegister()).toEqual({ text: "a", linewise: false });

    const deleteAtLineEnd = createEditor("abc");
    enterNormalAtStart(deleteAtLineEnd);
    sendKeys(deleteAtLineEnd, ["l", "l", "d", "l"]);

    expect(deleteAtLineEnd.getText()).toBe("ab");
    expect(deleteAtLineEnd.getRegister()).toEqual({
      text: "c",
      linewise: false,
    });

    const changeAtLineEnd = createEditor("abc");
    enterNormalAtStart(changeAtLineEnd);
    sendKeys(changeAtLineEnd, ["l", "l", "c", "l", "X", "\x1b"]);

    expect(changeAtLineEnd.getText()).toBe("abX");
    expect(changeAtLineEnd.getRegister()).toEqual({
      text: "c",
      linewise: false,
    });

    const yankAtLineEnd = createEditor("abc");
    enterNormalAtStart(yankAtLineEnd);
    sendKeys(yankAtLineEnd, ["l", "l", "y", "l"]);

    expect(yankAtLineEnd.getText()).toBe("abc");
    expect(yankAtLineEnd.getRegister()).toEqual({
      text: "c",
      linewise: false,
    });
  });

  it("uses Vim-inclusive ranges for end-of-line operators", () => {
    const editor = createEditor("abc\ndef\nghi");
    enterNormalAtStart(editor);
    sendKeys(editor, ["l", "d", "2", "$"]);

    expect(editor.getText()).toBe("a\nghi");
    expect(editor.getRegister()).toEqual({
      text: "bc\ndef",
      linewise: false,
    });
  });

  it("uses Vim word classes instead of whitespace-only WORD motions", () => {
    const normalMotion = createEditor("a.b c");
    enterNormalAtStart(normalMotion);
    normalMotion.handleInput("w");

    expect(normalMotion.getCursor()).toEqual({ line: 0, col: 1 });

    const deleteWord = createEditor("a.b c");
    enterNormalAtStart(deleteWord);
    sendKeys(deleteWord, ["d", "w"]);

    expect(deleteWord.getText()).toBe(".b c");
    expect(deleteWord.getRegister()).toEqual({ text: "a", linewise: false });

    const deletePunctuation = createEditor("a.b c");
    enterNormalAtStart(deletePunctuation);
    sendKeys(deletePunctuation, ["l", "d", "w"]);

    expect(deletePunctuation.getText()).toBe("ab c");
    expect(deletePunctuation.getRegister()).toEqual({
      text: ".",
      linewise: false,
    });
  });

  it("handles Vim's cw and dw end-of-line word-motion exceptions", () => {
    const changeWord = createEditor("abc def");
    enterNormalAtStart(changeWord);
    sendKeys(changeWord, ["c", "w", "X", "\x1b"]);

    expect(changeWord.getText()).toBe("X def");
    expect(changeWord.getRegister()).toEqual({ text: "abc", linewise: false });

    const changeWordFromEnd = createEditor("abc def");
    enterNormalAtStart(changeWordFromEnd);
    sendKeys(changeWordFromEnd, ["l", "l", "c", "w", "X", "\x1b"]);

    expect(changeWordFromEnd.getText()).toBe("abX def");
    expect(changeWordFromEnd.getRegister()).toEqual({
      text: "c",
      linewise: false,
    });

    const deleteWordAtLineEnd = createEditor("abc\ndef");
    enterNormalAtStart(deleteWordAtLineEnd);
    sendKeys(deleteWordAtLineEnd, ["d", "w"]);

    expect(deleteWordAtLineEnd.getText()).toBe("\ndef");
    expect(deleteWordAtLineEnd.getRegister()).toEqual({
      text: "abc",
      linewise: false,
    });
  });

  it("multiplies operator and motion counts for word motions", () => {
    const editor = createEditor("abc\ndef ghi");
    enterNormalAtStart(editor);
    sendKeys(editor, ["d", "2", "w"]);

    expect(editor.getText()).toBe("ghi");
    expect(editor.getRegister()).toEqual({
      text: "abc\ndef ",
      linewise: false,
    });
  });

  it("converts backward exclusive motions from column zero to linewise ranges", () => {
    const editor = createEditor("abc\ndef");
    enterNormalAtStart(editor);
    sendKeys(editor, ["j", "d", "b"]);

    expect(editor.getText()).toBe("def");
    expect(editor.getRegister()).toEqual({ text: "abc\n", linewise: true });

    editor.handleInput("p");

    expect(editor.getText()).toBe("def\nabc");
  });

  it("treats empty lines as Vim word-motion stops", () => {
    const normalMotion = createEditor("abc\n\ndef");
    enterNormalAtStart(normalMotion);
    normalMotion.handleInput("w");

    expect(normalMotion.getCursor()).toEqual({ line: 1, col: 0 });

    const countedNormalMotion = createEditor("abc\n\ndef");
    enterNormalAtStart(countedNormalMotion);
    sendKeys(countedNormalMotion, ["2", "w"]);

    expect(countedNormalMotion.getCursor()).toEqual({ line: 2, col: 0 });

    const deleteTwoWords = createEditor("abc\n\ndef");
    enterNormalAtStart(deleteTwoWords);
    sendKeys(deleteTwoWords, ["d", "2", "w"]);

    expect(deleteTwoWords.getText()).toBe("def");
    expect(deleteTwoWords.getRegister()).toEqual({
      text: "abc\n\n",
      linewise: true,
    });
  });
});

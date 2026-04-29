import { CustomEditor } from "@mariozechner/pi-coding-agent";
import {
  decodeKittyPrintable,
  matchesKey,
  parseKey,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";

import {
  bufferText,
  changeLineRange,
  clampPoint,
  clampPointToNormalCell,
  deleteLineRange,
  firstNonBlankCol,
  getRangeText,
  lineEndForInsert,
  lineFirstNonBlank,
  nextGraphemeEnd,
  normalizeRange,
  pointToOffset,
  previousGraphemeStart,
  replaceRange,
  yankLineRange,
  type BufferPoint,
  type BufferRange,
} from "../motion/text-buffer.js";
import {
  resolveVimMotion,
  vimOperatorRangeFromMotion,
  type VimOperatorRange,
} from "../motion/vim-motion.js";

export type ModalEditorMode = "normal" | "insert" | "operator-pending";

export type ModalOperator = "delete" | "change" | "yank";

export interface YankRegister {
  readonly text: string;
  readonly linewise: boolean;
}

export type StyleModeText = (text: string, mode: ModalEditorMode) => string;

export function getModeLabel(mode: ModalEditorMode): string {
  if (mode === "operator-pending") return "OPERATOR";
  return mode === "normal" ? "NORMAL" : "INSERT";
}

export function getModalKey(data: string): string | undefined {
  const decoded = decodeKittyPrintable(data);
  if (decoded !== undefined) return decoded;

  const parsed = parseKey(data);
  if (parsed === "space") return " ";
  if (parsed && parsed.length === 1) return parsed;
  if (data.length === 1 && data.charCodeAt(0) >= 32) return data;
  return parsed;
}

export function isTextInputData(data: string): boolean {
  if (decodeKittyPrintable(data) !== undefined) return true;
  if (data.includes("\x1b[200~")) return true;
  if (data.includes("\x1b")) return false;
  return [...data].some((character) => character.charCodeAt(0) >= 32);
}

export function getLegacyEscapeSuffixKey(data: string): string | undefined {
  if (data.length !== 2 || data[0] !== "\x1b") return undefined;
  const suffix = data[1];
  if (!suffix || suffix.charCodeAt(0) < 32) return undefined;
  return suffix;
}

export function buildModeBorderLine(
  width: number,
  mode: ModalEditorMode,
  borderColor: (text: string) => string,
  styleModeText: StyleModeText = (text) => text,
  detail = "",
): string {
  const safeWidth = Math.max(0, Math.floor(width));
  const modeText = `${getModeLabel(mode)}${detail ? ` ${detail}` : ""}`;
  const prefix = "── ";
  const suffix = " ──";
  const labelWidth =
    visibleWidth(prefix) + visibleWidth(modeText) + visibleWidth(suffix);

  if (safeWidth <= labelWidth) {
    return borderColor(
      truncateToWidth(`${prefix}${modeText}${suffix}`, safeWidth, ""),
    );
  }

  return (
    borderColor(prefix) +
    styleModeText(modeText, mode) +
    borderColor(`${suffix}${"─".repeat(safeWidth - labelWidth)}`)
  );
}

type CustomEditorConstructorArgs = ConstructorParameters<typeof CustomEditor>;

type EditorInternals = {
  state?: {
    lines: string[];
    cursorLine: number;
    cursorCol: number;
  };
  setCursorCol?: (col: number) => void;
};

type OperatorRange = VimOperatorRange;

const MAX_MODAL_COUNT = 10_000;

const OPERATOR_KEYS = {
  d: "delete",
  c: "change",
  y: "yank",
} as const satisfies Readonly<Record<string, ModalOperator>>;

const OPERATOR_LABELS = {
  delete: "d",
  change: "c",
  yank: "y",
} as const satisfies Readonly<Record<ModalOperator, string>>;

export class BetterModalMotionEditor extends CustomEditor {
  private mode: ModalEditorMode = "insert";
  private pendingCount = "";
  private pendingOperator: ModalOperator | undefined;
  private operatorCount = 1;
  private pendingCommand: "g" | undefined;
  private register: YankRegister | undefined;
  private normalDesiredColumn: number | undefined;

  constructor(
    tui: CustomEditorConstructorArgs[0],
    theme: CustomEditorConstructorArgs[1],
    keybindings: CustomEditorConstructorArgs[2],
    private readonly styleModeText: StyleModeText = (text) => text,
  ) {
    super(tui, theme, keybindings);
  }

  getMode(): ModalEditorMode {
    return this.mode;
  }

  getRegister(): YankRegister | undefined {
    return this.register;
  }

  handleInput(data: string): void {
    const legacyEscapeSuffixKey = getLegacyEscapeSuffixKey(data);
    if (this.mode === "insert" && legacyEscapeSuffixKey) {
      this.enterNormalModeFromInsert();
      this.handleNormalKey(legacyEscapeSuffixKey, legacyEscapeSuffixKey);
      return;
    }

    if (matchesKey(data, "escape")) {
      this.handleEscape(data);
      return;
    }

    if (this.mode === "insert") {
      super.handleInput(data);
      return;
    }

    const key = getModalKey(data);
    if (!key) {
      if (isTextInputData(data)) return;
      super.handleInput(data);
      return;
    }

    if (this.mode === "operator-pending") {
      this.handleOperatorPendingKey(key, data);
      return;
    }

    this.handleNormalKey(key, data);
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length === 0) return lines;

    lines[0] = buildModeBorderLine(
      width,
      this.getDisplayMode(),
      this.borderColor.bind(this),
      this.styleModeText,
    );
    return lines;
  }

  private handleEscape(data: string): void {
    if (this.mode === "insert") {
      if (this.isShowingAutocomplete()) {
        super.handleInput(data);
        return;
      }
      this.enterNormalModeFromInsert();
      return;
    }

    if (this.pendingOperator || this.pendingCount || this.pendingCommand) {
      this.clearPendingState();
      this.mode = "normal";
      this.tui.requestRender();
      return;
    }

    super.handleInput(data);
  }

  private handleNormalKey(key: string, data: string): void {
    if (this.pendingCommand === "g") {
      this.handleGCommand(key);
      return;
    }

    if (this.tryAppendCount(key)) return;

    switch (key) {
      case "i":
        this.enterInsertMode();
        return;
      case "a":
        this.moveRightForAppend();
        this.enterInsertMode();
        return;
      case "I":
        this.setCursor(lineFirstNonBlank(this.getLines(), this.getCursor()));
        this.enterInsertMode();
        return;
      case "A":
        this.setCursor(lineEndForInsert(this.getLines(), this.getCursor()));
        this.enterInsertMode();
        return;
      case "o":
        this.openLine("below");
        return;
      case "O":
        this.openLine("above");
        return;
      case "h":
      case "left":
      case "l":
      case "right":
      case "j":
      case "down":
      case "k":
      case "up":
        this.moveNormalByMotion(key, this.takeCount());
        return;
      case "0":
      case "home":
        this.moveNormalByMotion(key, this.takeCount());
        return;
      case "^":
        this.moveNormalByMotion(key, this.takeCount());
        return;
      case "$":
      case "end":
        this.moveNormalByMotion(key, this.takeCount());
        return;
      case "w":
      case "W":
      case "b":
      case "B":
      case "e":
      case "E":
        this.moveNormalByMotion(key, this.takeCount());
        return;
      case "g":
        this.pendingCommand = "g";
        this.tui.requestRender();
        return;
      case "G": {
        const hasCount = this.pendingCount.length > 0;
        const count = this.takeCount();
        this.goToLine(hasCount ? count : undefined);
        return;
      }
      case "x":
      case "delete":
        this.deleteForward(this.takeCount());
        return;
      case "X":
        this.deleteBackward(this.takeCount());
        return;
      case "D":
        this.pendingCount = "";
        this.deleteToLineEnd();
        return;
      case "C":
        this.pendingCount = "";
        this.changeToLineEnd();
        return;
      case "S":
        this.changeLines(this.takeCount());
        return;
      case "Y":
        this.yankLines(this.takeCount());
        return;
      case "p":
        this.pasteRegister("after", this.takeCount());
        return;
      case "P":
        this.pasteRegister("before", this.takeCount());
        return;
      case "u":
        this.pendingCount = "";
        super.handleInput("\x1f");
        this.setNormalCursor(this.getCursor());
        return;
      case "d":
      case "c":
      case "y":
        this.enterOperatorPending(OPERATOR_KEYS[key], this.takeCount());
        return;
      default:
        this.pendingCount = "";
        if (isTextInputData(data)) return;
        super.handleInput(data);
    }
  }

  private handleOperatorPendingKey(key: string, data: string): void {
    if (!this.pendingOperator) {
      this.mode = "normal";
      this.handleNormalKey(key, data);
      return;
    }

    if (this.tryAppendCount(key)) return;

    const operator = this.pendingOperator;
    const motionCount = this.takeCount();
    const count = this.operatorCount * motionCount;

    if (key === OPERATOR_LABELS[operator]) {
      this.applyLinewiseOperator(operator, count);
      return;
    }

    const motionRange = this.getOperatorRange(key, count, operator);
    if (!motionRange) {
      this.clearPendingState();
      this.mode = "normal";
      if (!isTextInputData(data)) super.handleInput(data);
      this.tui.requestRender();
      return;
    }

    this.applyOperatorRange(operator, motionRange);
  }

  private enterNormalModeFromInsert(): void {
    this.mode = "normal";
    this.clearPendingState();
    this.resetNormalDesiredColumn();
    const cursor = this.getCursor();
    const line = this.getLines()[cursor.line] ?? "";
    if (cursor.col > 0 && line.length > 0) {
      super.handleInput("\x1b[D");
      return;
    }
    this.setNormalCursor(cursor);
  }

  private enterInsertMode(): void {
    this.mode = "insert";
    this.clearPendingState();
    this.resetNormalDesiredColumn();
    this.tui.requestRender();
  }

  private enterOperatorPending(operator: ModalOperator, count: number): void {
    this.mode = "operator-pending";
    this.pendingOperator = operator;
    this.operatorCount = count;
    this.pendingCount = "";
    this.tui.requestRender();
  }

  private clearPendingState(): void {
    this.pendingCount = "";
    this.pendingOperator = undefined;
    this.operatorCount = 1;
    this.pendingCommand = undefined;
  }

  private tryAppendCount(key: string): boolean {
    if (!/^\d$/u.test(key)) return false;
    if (key === "0" && this.pendingCount.length === 0) return false;

    const nextCount = Number.parseInt(`${this.pendingCount}${key}`, 10);
    this.pendingCount = String(
      Number.isFinite(nextCount)
        ? Math.min(nextCount, MAX_MODAL_COUNT)
        : MAX_MODAL_COUNT,
    );
    this.tui.requestRender();
    return true;
  }

  private takeCount(): number {
    const count = this.pendingCount
      ? Number.parseInt(this.pendingCount, 10)
      : 1;
    this.pendingCount = "";
    if (!Number.isFinite(count) || count <= 0) return 1;
    return Math.min(count, MAX_MODAL_COUNT);
  }

  private getDisplayMode(): Exclude<ModalEditorMode, "operator-pending"> {
    return this.mode === "insert" ? "insert" : "normal";
  }

  private moveNormalByMotion(key: string, count: number): void {
    const lines = this.getLines();
    const cursor = clampPointToNormalCell(lines, this.getCursor());
    const isVerticalMotion =
      key === "j" || key === "down" || key === "k" || key === "up";

    if (isVerticalMotion && this.normalDesiredColumn === undefined) {
      this.normalDesiredColumn = cursor.col;
    }

    const motion = resolveVimMotion(
      lines,
      cursor,
      key,
      count,
      this.normalDesiredColumn === undefined
        ? {}
        : { desiredColumn: this.normalDesiredColumn },
    );
    if (!motion) return;

    if (!isVerticalMotion) this.normalDesiredColumn = undefined;
    this.setNormalCursor(motion.target);
  }

  private resetNormalDesiredColumn(): void {
    this.normalDesiredColumn = undefined;
  }

  private setCursor(point: BufferPoint): void {
    const lines = this.getLines();
    const cursor = clampPoint(lines, point);
    const internals = this as unknown as EditorInternals;

    if (internals.state && typeof internals.setCursorCol === "function") {
      internals.state.cursorLine = cursor.line;
      internals.setCursorCol(cursor.col);
      this.tui.requestRender();
      return;
    }

    this.setTextAndCursorWithPublicApi(lines, cursor);
  }

  private setNormalCursor(point: BufferPoint): void {
    this.setCursor(clampPointToNormalCell(this.getLines(), point));
  }

  private setTextAndCursor(lines: readonly string[], point: BufferPoint): void {
    this.resetNormalDesiredColumn();
    const nextLines = lines.length > 0 ? [...lines] : [""];
    this.setText(bufferText(nextLines));
    this.setCursor(point);
  }

  private setTextAndCursorWithPublicApi(
    lines: readonly string[],
    point: BufferPoint,
  ): void {
    const cursor = clampPoint(lines, point);
    this.setText(bufferText(lines));
    const endOffset = bufferText(lines).length;
    const targetOffset = pointToOffset(lines, cursor);
    const distance = Math.max(0, endOffset - targetOffset);
    for (let step = 0; step < distance; step += 1) {
      super.handleInput("\x1b[D");
    }
  }

  private moveRightForAppend(): void {
    const lines = this.getLines();
    const cursor = clampPoint(lines, this.getCursor());
    const line = lines[cursor.line] ?? "";
    this.setCursor({
      line: cursor.line,
      col: line.length === 0 ? 0 : nextGraphemeEnd(line, cursor.col),
    });
  }

  private openLine(direction: "above" | "below"): void {
    const lines = this.getLines();
    const cursor = clampPoint(lines, this.getCursor());
    const insertAt = direction === "above" ? cursor.line : cursor.line + 1;
    const nextLines = [...lines];
    nextLines.splice(insertAt, 0, "");
    this.mode = "insert";
    this.clearPendingState();
    this.setTextAndCursor(nextLines, { line: insertAt, col: 0 });
  }

  private goToLine(lineNumber: number | undefined): void {
    this.resetNormalDesiredColumn();
    const lines = this.getLines();
    const targetLine =
      lineNumber === undefined
        ? lines.length - 1
        : Math.max(0, Math.min(lines.length - 1, lineNumber - 1));
    this.setNormalCursor({
      line: targetLine,
      col: firstNonBlankCol(lines[targetLine] ?? ""),
    });
  }

  private handleGCommand(key: string): void {
    if (key === "g") {
      const count = this.takeCount();
      this.pendingCommand = undefined;
      this.goToLine(count === 1 ? 1 : count);
      return;
    }

    this.pendingCommand = undefined;
    this.pendingCount = "";
    this.tui.requestRender();
  }

  private deleteForward(count: number): void {
    const lines = this.getLines();
    const cursor = clampPointToNormalCell(lines, this.getCursor());
    const line = lines[cursor.line] ?? "";
    if (line.length === 0 || cursor.col >= line.length) return;

    let endCol = cursor.col;
    for (let step = 0; step < count; step += 1) {
      if (endCol >= line.length) break;
      endCol = nextGraphemeEnd(line, endCol);
    }

    this.deleteRange({
      start: cursor,
      end: { line: cursor.line, col: endCol },
    });
  }

  private deleteBackward(count: number): void {
    const lines = this.getLines();
    const cursor = clampPoint(lines, this.getCursor());
    const line = lines[cursor.line] ?? "";
    if (line.length === 0 || cursor.col <= 0) return;

    let startCol = cursor.col;
    for (let step = 0; step < count; step += 1) {
      if (startCol <= 0) break;
      startCol = previousGraphemeStart(line, startCol);
    }

    this.deleteRange({
      start: { line: cursor.line, col: startCol },
      end: cursor,
    });
  }

  private deleteToLineEnd(): void {
    const lines = this.getLines();
    const cursor = clampPointToNormalCell(lines, this.getCursor());
    this.deleteRange({ start: cursor, end: lineEndForInsert(lines, cursor) });
  }

  private changeToLineEnd(): void {
    const lines = this.getLines();
    const cursor = clampPointToNormalCell(lines, this.getCursor());
    this.changeRange({ start: cursor, end: lineEndForInsert(lines, cursor) });
  }

  private deleteRange(range: BufferRange): void {
    const lines = this.getLines();
    const normalizedRange = normalizeRange(range);
    const text = getRangeText(lines, normalizedRange);
    if (!text) {
      this.mode = "normal";
      this.clearPendingState();
      this.tui.requestRender();
      return;
    }
    this.register = { text, linewise: false };
    const result = replaceRange(lines, normalizedRange, "");
    this.mode = "normal";
    this.clearPendingState();
    this.setTextAndCursor(
      result.lines,
      clampPointToNormalCell(result.lines, normalizedRange.start),
    );
  }

  private changeRange(range: BufferRange): void {
    const lines = this.getLines();
    const normalizedRange = normalizeRange(range);
    const text = getRangeText(lines, normalizedRange);
    if (!text) {
      this.mode = "normal";
      this.clearPendingState();
      this.tui.requestRender();
      return;
    }
    this.register = { text, linewise: false };
    const result = replaceRange(lines, normalizedRange, "");
    this.mode = "insert";
    this.clearPendingState();
    this.setTextAndCursor(result.lines, normalizedRange.start);
  }

  private yankRange(range: BufferRange): void {
    const text = getRangeText(this.getLines(), normalizeRange(range));
    if (text) this.register = { text, linewise: false };
    this.mode = "normal";
    this.clearPendingState();
    this.tui.requestRender();
  }

  private changeLines(count: number): void {
    const result = changeLineRange(this.getLines(), this.getCursor(), count);
    this.register = { text: result.text, linewise: true };
    this.mode = "insert";
    this.clearPendingState();
    this.setTextAndCursor(result.lines, result.cursor);
  }

  private yankLines(count: number): void {
    this.register = {
      text: yankLineRange(this.getLines(), this.getCursor(), count),
      linewise: true,
    };
    this.mode = "normal";
    this.clearPendingState();
    this.tui.requestRender();
  }

  private applyLinewiseOperator(operator: ModalOperator, count: number): void {
    if (operator === "yank") {
      this.yankLines(count);
      return;
    }

    if (operator === "change") {
      this.changeLines(count);
      return;
    }

    const result = deleteLineRange(this.getLines(), this.getCursor(), count);
    this.register = { text: result.text, linewise: true };
    this.mode = "normal";
    this.clearPendingState();
    this.setTextAndCursor(result.lines, result.cursor);
  }

  private applyOperatorRange(
    operator: ModalOperator,
    operatorRange: OperatorRange,
  ): void {
    if (operatorRange.linewise) {
      const lineCount =
        Math.abs(
          operatorRange.range.end.line - operatorRange.range.start.line,
        ) + 1;
      const cursor = operatorRange.range.start;
      this.setCursor(cursor);
      this.applyLinewiseOperator(operator, lineCount);
      return;
    }

    if (operator === "delete") {
      this.deleteRange(operatorRange.range);
      return;
    }
    if (operator === "change") {
      this.changeRange(operatorRange.range);
      return;
    }
    this.yankRange(operatorRange.range);
  }

  private getOperatorRange(
    key: string,
    count: number,
    operator: ModalOperator,
  ): OperatorRange | undefined {
    const lines = this.getLines();
    const motion = resolveVimMotion(lines, this.getCursor(), key, count, {
      operator,
    });
    return motion ? vimOperatorRangeFromMotion(lines, motion) : undefined;
  }

  private pasteRegister(position: "before" | "after", count: number): void {
    if (!this.register) return;

    if (this.register.linewise) {
      this.pasteLinewise(position, count);
      return;
    }

    const lines = this.getLines();
    const cursor = clampPointToNormalCell(lines, this.getCursor());
    const line = lines[cursor.line] ?? "";
    const pastePoint =
      position === "before" || line.length === 0
        ? cursor
        : { line: cursor.line, col: nextGraphemeEnd(line, cursor.col) };
    const replacement = this.register.text.repeat(Math.max(1, count));
    const result = replaceRange(
      lines,
      { start: pastePoint, end: pastePoint },
      replacement,
    );
    this.mode = "normal";
    this.clearPendingState();
    this.setTextAndCursor(
      result.lines,
      clampPointToNormalCell(result.lines, result.cursor),
    );
  }

  private pasteLinewise(position: "before" | "after", count: number): void {
    if (!this.register) return;
    const lines = this.getLines();
    const cursor = clampPoint(lines, this.getCursor());
    const insertAt = position === "before" ? cursor.line : cursor.line + 1;
    const registerLines = this.register.text.endsWith("\n")
      ? this.register.text.slice(0, -1).split("\n")
      : this.register.text.split("\n");
    const repeatedLines = Array.from({ length: Math.max(1, count) }).flatMap(
      () => registerLines,
    );
    const nextLines = [...lines];
    nextLines.splice(insertAt, 0, ...repeatedLines);
    this.mode = "normal";
    this.clearPendingState();
    this.setTextAndCursor(nextLines, { line: insertAt, col: 0 });
  }
}

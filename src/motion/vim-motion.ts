import {
  clampPoint,
  clampPointToNormalCell,
  comparePoints,
  ensureLines,
  firstNonBlankCol,
  lineEndForInsert,
  lineEndForNormal,
  moveLeftInLine,
  moveRightInNormalLine,
  nextGraphemeEnd,
  offsetToPoint,
  pointToOffset,
  type BufferPoint,
  type BufferRange,
} from "./text-buffer.js";

export type VimMotionKind = "charwise" | "linewise";

export type VimOperatorName = "delete" | "change" | "yank";

export type VimWordMode = "word" | "WORD";

export interface VimMotionResult {
  readonly start: BufferPoint;
  readonly target: BufferPoint;
  readonly kind: VimMotionKind;
  readonly inclusive: boolean;
}

export interface VimOperatorRange {
  readonly range: BufferRange;
  readonly linewise: boolean;
}

export interface ResolveVimMotionOptions {
  readonly operator?: VimOperatorName;
  readonly desiredColumn?: number;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

function graphemes(text: string): Intl.SegmentData[] {
  return [...graphemeSegmenter.segment(text)];
}

function safeCount(count: number): number {
  return Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
}

function bufferText(lines: readonly string[]): string {
  return ensureLines(lines).join("\n");
}

function segmentAtOrAfter(
  segments: readonly Intl.SegmentData[],
  offset: number,
): number {
  const index = segments.findIndex((segment) => segment.index >= offset);
  return index >= 0 ? index : segments.length;
}

function segmentBefore(
  segments: readonly Intl.SegmentData[],
  offset: number,
): number {
  return segmentAtOrAfter(segments, offset) - 1;
}

function isWhitespace(segment: string | undefined): boolean {
  return segment !== undefined && /^\s$/u.test(segment);
}

function isKeyword(segment: string | undefined): boolean {
  return segment !== undefined && /^[\p{Letter}\p{Number}_]+$/u.test(segment);
}

function wordClass(
  segment: string | undefined,
  mode: VimWordMode,
): "space" | "keyword" | "punct" | "WORD" {
  if (isWhitespace(segment)) return "space";
  if (mode === "WORD") return "WORD";
  return isKeyword(segment) ? "keyword" : "punct";
}

function sameWordRun(
  left: Intl.SegmentData | undefined,
  right: Intl.SegmentData | undefined,
  mode: VimWordMode,
): boolean {
  if (!left || !right) return false;
  const leftClass = wordClass(left.segment, mode);
  return leftClass !== "space" && leftClass === wordClass(right.segment, mode);
}

function isRunEnd(
  segments: readonly Intl.SegmentData[],
  index: number,
  mode: VimWordMode,
): boolean {
  return !sameWordRun(segments[index], segments[index + 1], mode);
}

function nextWordStartOffset(
  text: string,
  offset: number,
  count: number,
  mode: VimWordMode,
): number {
  const segments = graphemes(text);
  if (segments.length === 0) return 0;

  let index = segmentAtOrAfter(segments, Math.max(0, offset));
  for (let step = 0; step < safeCount(count); step += 1) {
    const currentClass = wordClass(segments[index]?.segment, mode);
    if (currentClass !== "space") {
      while (sameWordRun(segments[index], segments[index + 1], mode)) {
        index += 1;
      }
      if (index < segments.length) index += 1;
    }

    while (wordClass(segments[index]?.segment, mode) === "space") {
      index += 1;
    }
  }

  return segments[index]?.index ?? text.length;
}

function previousWordStartOffset(
  text: string,
  offset: number,
  count: number,
  mode: VimWordMode,
): number {
  const segments = graphemes(text);
  if (segments.length === 0) return 0;

  let index = segmentBefore(segments, Math.max(0, offset));
  if (index < 0) return 0;

  for (let step = 0; step < safeCount(count); step += 1) {
    while (
      index >= 0 &&
      wordClass(segments[index]?.segment, mode) === "space"
    ) {
      index -= 1;
    }
    if (index < 0) return 0;

    while (sameWordRun(segments[index - 1], segments[index], mode)) {
      index -= 1;
    }

    if (step < safeCount(count) - 1) index -= 1;
  }

  return segments[Math.max(0, index)]?.index ?? 0;
}

function wordEndOffset(
  text: string,
  offset: number,
  count: number,
  mode: VimWordMode,
): number {
  const segments = graphemes(text);
  if (segments.length === 0) return 0;

  let index = segmentAtOrAfter(segments, Math.max(0, offset));
  for (let step = 0; step < safeCount(count); step += 1) {
    if (
      index < segments.length &&
      step === 0 &&
      segments[index]?.index === offset &&
      wordClass(segments[index]?.segment, mode) !== "space" &&
      isRunEnd(segments, index, mode)
    ) {
      index += 1;
    } else if (step > 0) {
      index += 1;
    }

    while (wordClass(segments[index]?.segment, mode) === "space") {
      index += 1;
    }
    if (index >= segments.length) return text.length;

    while (sameWordRun(segments[index], segments[index + 1], mode)) {
      index += 1;
    }
  }

  return segments[Math.min(index, segments.length - 1)]?.index ?? text.length;
}

function changeWordEndOffset(
  text: string,
  offset: number,
  count: number,
  mode: VimWordMode,
): number {
  const segments = graphemes(text);
  if (segments.length === 0) return 0;

  let index = segmentAtOrAfter(segments, Math.max(0, offset));
  const normalizedCount = safeCount(count);
  for (let step = 0; step < normalizedCount; step += 1) {
    while (wordClass(segments[index]?.segment, mode) === "space") {
      index += 1;
    }
    if (index >= segments.length) return text.length;

    while (sameWordRun(segments[index], segments[index + 1], mode)) {
      index += 1;
    }

    if (step < normalizedCount - 1) index += 1;
  }

  return segments[Math.min(index, segments.length - 1)]?.index ?? text.length;
}

function isNonBlankAt(lines: readonly string[], point: BufferPoint): boolean {
  const line = ensureLines(lines)[point.line] ?? "";
  const segment = graphemes(line.slice(point.col))[0]?.segment;
  return segment !== undefined && !isWhitespace(segment);
}

function adjustOperatorWordEndOfLine(
  lines: readonly string[],
  start: BufferPoint,
  target: BufferPoint,
  count: number,
): BufferPoint {
  if (safeCount(count) !== 1 || target.line <= start.line) return target;

  const startLine = ensureLines(lines)[start.line] ?? "";
  const lineTail = startLine.slice(start.col);
  if (!lineTail || /^\s*$/u.test(lineTail)) return target;

  return lineEndForInsert(lines, start);
}

function moveRightOperatorEndInLine(
  lines: readonly string[],
  point: BufferPoint,
  count: number,
): BufferPoint {
  const safeLines = ensureLines(lines);
  const cursor = clampPointToNormalCell(safeLines, point);
  const line = safeLines[cursor.line] ?? "";
  let col = cursor.col;

  for (let step = 0; step < safeCount(count); step += 1) {
    if (col >= line.length) break;
    col = nextGraphemeEnd(line, col);
  }

  return { line: cursor.line, col };
}

function makeMotion(
  start: BufferPoint,
  target: BufferPoint,
  kind: VimMotionKind,
  inclusive: boolean,
): VimMotionResult {
  return { start, target, kind, inclusive };
}

export function resolveVimMotion(
  lines: readonly string[],
  cursor: BufferPoint,
  motion: string,
  count = 1,
  options: ResolveVimMotionOptions = {},
): VimMotionResult | undefined {
  const safeLines = ensureLines(lines);
  const start = clampPointToNormalCell(safeLines, cursor);
  const normalizedCount = safeCount(count);
  const text = bufferText(safeLines);
  const startOffset = pointToOffset(safeLines, start);

  switch (motion) {
    case "h":
    case "left":
      return makeMotion(
        start,
        moveLeftInLine(safeLines, start, normalizedCount),
        "charwise",
        false,
      );
    case "l":
    case "right":
    case " ":
      return makeMotion(
        start,
        options.operator
          ? moveRightOperatorEndInLine(safeLines, start, normalizedCount)
          : moveRightInNormalLine(safeLines, start, normalizedCount),
        "charwise",
        false,
      );
    case "j":
    case "down": {
      const line = Math.min(safeLines.length - 1, start.line + normalizedCount);
      const col = options.desiredColumn ?? start.col;
      return makeMotion(
        start,
        clampPointToNormalCell(safeLines, { line, col }),
        "linewise",
        true,
      );
    }
    case "k":
    case "up": {
      const line = Math.max(0, start.line - normalizedCount);
      const col = options.desiredColumn ?? start.col;
      return makeMotion(
        start,
        clampPointToNormalCell(safeLines, { line, col }),
        "linewise",
        true,
      );
    }
    case "0":
    case "home":
      return makeMotion(start, { line: start.line, col: 0 }, "charwise", false);
    case "^":
      return makeMotion(
        start,
        {
          line: start.line,
          col: firstNonBlankCol(safeLines[start.line] ?? ""),
        },
        "charwise",
        false,
      );
    case "$":
    case "end": {
      const line = Math.min(
        safeLines.length - 1,
        start.line + normalizedCount - 1,
      );
      return makeMotion(
        start,
        lineEndForNormal(safeLines, { line, col: 0 }),
        "charwise",
        true,
      );
    }
    case "w": {
      if (options.operator === "change" && isNonBlankAt(safeLines, start)) {
        return makeMotion(
          start,
          offsetToPoint(
            safeLines,
            changeWordEndOffset(text, startOffset, normalizedCount, "word"),
          ),
          "charwise",
          true,
        );
      }

      const rawTarget = offsetToPoint(
        safeLines,
        nextWordStartOffset(text, startOffset, normalizedCount, "word"),
      );
      const target = options.operator
        ? adjustOperatorWordEndOfLine(
            safeLines,
            start,
            rawTarget,
            normalizedCount,
          )
        : rawTarget;
      return makeMotion(start, target, "charwise", false);
    }
    case "W": {
      if (options.operator === "change" && isNonBlankAt(safeLines, start)) {
        return makeMotion(
          start,
          offsetToPoint(
            safeLines,
            changeWordEndOffset(text, startOffset, normalizedCount, "WORD"),
          ),
          "charwise",
          true,
        );
      }

      const rawTarget = offsetToPoint(
        safeLines,
        nextWordStartOffset(text, startOffset, normalizedCount, "WORD"),
      );
      const target = options.operator
        ? adjustOperatorWordEndOfLine(
            safeLines,
            start,
            rawTarget,
            normalizedCount,
          )
        : rawTarget;
      return makeMotion(start, target, "charwise", false);
    }
    case "b":
      return makeMotion(
        start,
        offsetToPoint(
          safeLines,
          previousWordStartOffset(text, startOffset, normalizedCount, "word"),
        ),
        "charwise",
        false,
      );
    case "B":
      return makeMotion(
        start,
        offsetToPoint(
          safeLines,
          previousWordStartOffset(text, startOffset, normalizedCount, "WORD"),
        ),
        "charwise",
        false,
      );
    case "e":
      return makeMotion(
        start,
        offsetToPoint(
          safeLines,
          wordEndOffset(text, startOffset, normalizedCount, "word"),
        ),
        "charwise",
        true,
      );
    case "E":
      return makeMotion(
        start,
        offsetToPoint(
          safeLines,
          wordEndOffset(text, startOffset, normalizedCount, "WORD"),
        ),
        "charwise",
        true,
      );
    default:
      return undefined;
  }
}

function pointAfter(lines: readonly string[], point: BufferPoint): BufferPoint {
  const clamped = clampPoint(lines, point);
  const line = ensureLines(lines)[clamped.line] ?? "";
  return {
    line: clamped.line,
    col: nextGraphemeEnd(line, clamped.col),
  };
}

export function vimOperatorRangeFromMotion(
  lines: readonly string[],
  motion: VimMotionResult,
): VimOperatorRange {
  const safeLines = ensureLines(lines);

  if (motion.kind === "linewise") {
    const startLine = Math.min(motion.start.line, motion.target.line);
    const endLine = Math.max(motion.start.line, motion.target.line);
    return {
      range: {
        start: { line: startLine, col: 0 },
        end: { line: endLine, col: 0 },
      },
      linewise: true,
    };
  }

  const start = clampPoint(safeLines, motion.start);
  const target = clampPoint(safeLines, motion.target);
  const movesForward = comparePoints(start, target) <= 0;

  if (motion.inclusive) {
    return movesForward
      ? {
          range: { start, end: pointAfter(safeLines, target) },
          linewise: false,
        }
      : {
          range: { start: target, end: pointAfter(safeLines, start) },
          linewise: false,
        };
  }

  if (
    !movesForward &&
    target.line < start.line &&
    target.col === 0 &&
    start.col <= firstNonBlankCol(safeLines[start.line] ?? "")
  ) {
    return {
      range: {
        start: { line: target.line, col: 0 },
        end: { line: start.line - 1, col: 0 },
      },
      linewise: true,
    };
  }

  return movesForward
    ? { range: { start, end: target }, linewise: false }
    : { range: { start: target, end: start }, linewise: false };
}

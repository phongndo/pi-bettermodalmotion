export interface BufferPoint {
  readonly line: number;
  readonly col: number;
}

export interface BufferRange {
  readonly start: BufferPoint;
  readonly end: BufferPoint;
}

export interface ReplaceRangeResult {
  readonly lines: string[];
  readonly cursor: BufferPoint;
}

export interface LineEditResult {
  readonly lines: string[];
  readonly cursor: BufferPoint;
  readonly text: string;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export function ensureLines(lines: readonly string[]): string[] {
  return lines.length > 0 ? [...lines] : [""];
}

export function clampPoint(
  lines: readonly string[],
  point: BufferPoint,
): BufferPoint {
  const safeLines = ensureLines(lines);
  const line = Math.max(0, Math.min(point.line, safeLines.length - 1));
  const text = safeLines[line] ?? "";
  return {
    line,
    col: Math.max(0, Math.min(point.col, text.length)),
  };
}

export function comparePoints(a: BufferPoint, b: BufferPoint): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.col - b.col;
}

export function normalizeRange(range: BufferRange): BufferRange {
  return comparePoints(range.start, range.end) <= 0
    ? range
    : { start: range.end, end: range.start };
}

function graphemes(text: string): Intl.SegmentData[] {
  return [...graphemeSegmenter.segment(text)];
}

export function previousGraphemeStart(text: string, col: number): number {
  const before = text.slice(0, Math.max(0, Math.min(col, text.length)));
  const segments = graphemes(before);
  const previous = segments.at(-1);
  return previous?.index ?? 0;
}

export function nextGraphemeEnd(text: string, col: number): number {
  const safeCol = Math.max(0, Math.min(col, text.length));
  if (safeCol >= text.length) return text.length;
  const after = text.slice(safeCol);
  const next = graphemes(after)[0];
  return Math.min(text.length, safeCol + (next?.segment.length ?? 1));
}

export function lastGraphemeStart(text: string): number {
  if (text.length === 0) return 0;
  return graphemes(text).at(-1)?.index ?? 0;
}

export function clampPointToNormalCell(
  lines: readonly string[],
  point: BufferPoint,
): BufferPoint {
  const clamped = clampPoint(lines, point);
  const line = ensureLines(lines)[clamped.line] ?? "";
  if (line.length === 0) return { line: clamped.line, col: 0 };
  return {
    line: clamped.line,
    col: Math.min(clamped.col, lastGraphemeStart(line)),
  };
}

export function pointToOffset(
  lines: readonly string[],
  point: BufferPoint,
): number {
  const safeLines = ensureLines(lines);
  const clamped = clampPoint(safeLines, point);
  let offset = 0;
  for (let line = 0; line < clamped.line; line += 1) {
    offset += (safeLines[line] ?? "").length + 1;
  }
  return offset + clamped.col;
}

export function offsetToPoint(
  lines: readonly string[],
  offset: number,
): BufferPoint {
  const safeLines = ensureLines(lines);
  let remaining = Math.max(0, offset);

  for (let line = 0; line < safeLines.length; line += 1) {
    const text = safeLines[line] ?? "";
    if (remaining <= text.length) {
      return { line, col: remaining };
    }
    remaining -= text.length;
    if (line < safeLines.length - 1) {
      if (remaining === 0) return { line: line + 1, col: 0 };
      remaining -= 1;
    }
  }

  const lastLine = safeLines.length - 1;
  return { line: lastLine, col: (safeLines[lastLine] ?? "").length };
}

export function bufferText(lines: readonly string[]): string {
  return ensureLines(lines).join("\n");
}

export function getRangeText(
  lines: readonly string[],
  range: BufferRange,
): string {
  const safeLines = ensureLines(lines);
  const normalized = normalizeRange({
    start: clampPoint(safeLines, range.start),
    end: clampPoint(safeLines, range.end),
  });
  const text = bufferText(safeLines);
  return text.slice(
    pointToOffset(safeLines, normalized.start),
    pointToOffset(safeLines, normalized.end),
  );
}

export function replaceRange(
  lines: readonly string[],
  range: BufferRange,
  replacement: string,
): ReplaceRangeResult {
  const safeLines = ensureLines(lines);
  const normalized = normalizeRange({
    start: clampPoint(safeLines, range.start),
    end: clampPoint(safeLines, range.end),
  });
  const text = bufferText(safeLines);
  const startOffset = pointToOffset(safeLines, normalized.start);
  const nextText =
    text.slice(0, startOffset) +
    replacement +
    text.slice(pointToOffset(safeLines, normalized.end));
  const nextLines = ensureLines(nextText.split("\n"));
  const cursor = offsetToPoint(nextLines, startOffset + replacement.length);
  return { lines: nextLines, cursor };
}

export function moveLeftInLine(
  lines: readonly string[],
  point: BufferPoint,
  count = 1,
): BufferPoint {
  const safeLines = ensureLines(lines);
  let cursor = clampPoint(safeLines, point);
  for (let step = 0; step < count; step += 1) {
    const line = safeLines[cursor.line] ?? "";
    if (cursor.col <= 0) break;
    cursor = {
      line: cursor.line,
      col: previousGraphemeStart(line, cursor.col),
    };
  }
  return cursor;
}

export function moveRightInNormalLine(
  lines: readonly string[],
  point: BufferPoint,
  count = 1,
): BufferPoint {
  const safeLines = ensureLines(lines);
  let cursor = clampPointToNormalCell(safeLines, point);
  for (let step = 0; step < count; step += 1) {
    const line = safeLines[cursor.line] ?? "";
    const lastCol = lastGraphemeStart(line);
    if (line.length === 0 || cursor.col >= lastCol) break;
    cursor = {
      line: cursor.line,
      col: nextGraphemeEnd(line, cursor.col),
    };
  }
  return clampPointToNormalCell(safeLines, cursor);
}

export function moveVerticallyByLine(
  lines: readonly string[],
  point: BufferPoint,
  delta: number,
): BufferPoint {
  const safeLines = ensureLines(lines);
  const cursor = clampPoint(safeLines, point);
  const targetLine = Math.max(
    0,
    Math.min(safeLines.length - 1, cursor.line + delta),
  );
  return clampPointToNormalCell(safeLines, {
    line: targetLine,
    col: cursor.col,
  });
}

export function firstNonBlankCol(text: string): number {
  const match = /\S/u.exec(text);
  return match?.index ?? 0;
}

export function lineStart(
  lines: readonly string[],
  point: BufferPoint,
): BufferPoint {
  return { line: clampPoint(lines, point).line, col: 0 };
}

export function lineFirstNonBlank(
  lines: readonly string[],
  point: BufferPoint,
): BufferPoint {
  const safeLines = ensureLines(lines);
  const line = clampPoint(safeLines, point).line;
  return { line, col: firstNonBlankCol(safeLines[line] ?? "") };
}

export function lineEndForInsert(
  lines: readonly string[],
  point: BufferPoint,
): BufferPoint {
  const safeLines = ensureLines(lines);
  const line = clampPoint(safeLines, point).line;
  return { line, col: (safeLines[line] ?? "").length };
}

export function lineEndForNormal(
  lines: readonly string[],
  point: BufferPoint,
): BufferPoint {
  const safeLines = ensureLines(lines);
  const line = clampPoint(safeLines, point).line;
  return clampPointToNormalCell(safeLines, {
    line,
    col: (safeLines[line] ?? "").length,
  });
}

function isWhitespaceCharacter(character: string | undefined): boolean {
  return character !== undefined && /^\s$/u.test(character);
}

function segmentFlatText(text: string): Intl.SegmentData[] {
  return graphemes(text);
}

function segmentAtOrAfter(
  segments: readonly Intl.SegmentData[],
  offset: number,
): number {
  const index = segments.findIndex((segment) => segment.index >= offset);
  return index >= 0 ? index : segments.length;
}

export function nextWordStartOffset(
  text: string,
  offset: number,
  count = 1,
): number {
  const segments = segmentFlatText(text);
  if (segments.length === 0) return 0;

  let index = segmentAtOrAfter(segments, Math.max(0, offset));
  for (let step = 0; step < count; step += 1) {
    if (
      index < segments.length &&
      !isWhitespaceCharacter(segments[index]?.segment)
    ) {
      while (
        index < segments.length &&
        !isWhitespaceCharacter(segments[index]?.segment)
      ) {
        index += 1;
      }
    }
    while (
      index < segments.length &&
      isWhitespaceCharacter(segments[index]?.segment)
    ) {
      index += 1;
    }
  }

  return segments[index]?.index ?? text.length;
}

export function previousWordStartOffset(
  text: string,
  offset: number,
  count = 1,
): number {
  const segments = segmentFlatText(text);
  if (segments.length === 0) return 0;

  let index =
    Math.min(segmentAtOrAfter(segments, Math.max(0, offset)), segments.length) -
    1;
  for (let step = 0; step < count; step += 1) {
    while (index >= 0 && isWhitespaceCharacter(segments[index]?.segment)) {
      index -= 1;
    }
    while (index > 0 && !isWhitespaceCharacter(segments[index - 1]?.segment)) {
      index -= 1;
    }
    if (step < count - 1) index -= 1;
  }

  return segments[Math.max(0, index)]?.index ?? 0;
}

export function wordEndOffset(text: string, offset: number, count = 1): number {
  const segments = segmentFlatText(text);
  if (segments.length === 0) return 0;

  let index = segmentAtOrAfter(segments, Math.max(0, offset));
  for (let step = 0; step < count; step += 1) {
    while (
      index < segments.length &&
      isWhitespaceCharacter(segments[index]?.segment)
    ) {
      index += 1;
    }
    while (
      index < segments.length - 1 &&
      !isWhitespaceCharacter(segments[index + 1]?.segment)
    ) {
      index += 1;
    }
    if (step < count - 1) index += 1;
  }

  return segments[Math.min(index, segments.length - 1)]?.index ?? text.length;
}

export function moveToNextWordStart(
  lines: readonly string[],
  point: BufferPoint,
  count = 1,
): BufferPoint {
  const safeLines = ensureLines(lines);
  const text = bufferText(safeLines);
  return clampPointToNormalCell(
    safeLines,
    offsetToPoint(
      safeLines,
      nextWordStartOffset(text, pointToOffset(safeLines, point), count),
    ),
  );
}

export function moveToPreviousWordStart(
  lines: readonly string[],
  point: BufferPoint,
  count = 1,
): BufferPoint {
  const safeLines = ensureLines(lines);
  const text = bufferText(safeLines);
  return clampPointToNormalCell(
    safeLines,
    offsetToPoint(
      safeLines,
      previousWordStartOffset(text, pointToOffset(safeLines, point), count),
    ),
  );
}

export function moveToWordEnd(
  lines: readonly string[],
  point: BufferPoint,
  count = 1,
): BufferPoint {
  const safeLines = ensureLines(lines);
  const text = bufferText(safeLines);
  return clampPointToNormalCell(
    safeLines,
    offsetToPoint(
      safeLines,
      wordEndOffset(text, pointToOffset(safeLines, point), count),
    ),
  );
}

export function deleteLineRange(
  lines: readonly string[],
  point: BufferPoint,
  count = 1,
): LineEditResult {
  const safeLines = ensureLines(lines);
  const cursor = clampPoint(safeLines, point);
  const startLine = cursor.line;
  const deleteCount = Math.max(1, count);
  const endLine = Math.min(safeLines.length, startLine + deleteCount);
  const removed = safeLines.slice(startLine, endLine);
  const nextLines = [
    ...safeLines.slice(0, startLine),
    ...safeLines.slice(endLine),
  ];

  const linesAfterDelete = ensureLines(nextLines);
  const nextLine = Math.min(startLine, linesAfterDelete.length - 1);
  return {
    lines: linesAfterDelete,
    cursor: clampPointToNormalCell(linesAfterDelete, {
      line: nextLine,
      col: 0,
    }),
    text: `${removed.join("\n")}\n`,
  };
}

export function changeLineRange(
  lines: readonly string[],
  point: BufferPoint,
  count = 1,
): LineEditResult {
  const safeLines = ensureLines(lines);
  const cursor = clampPoint(safeLines, point);
  const startLine = cursor.line;
  const deleteCount = Math.max(1, count);
  const endLine = Math.min(safeLines.length, startLine + deleteCount);
  const removed = safeLines.slice(startLine, endLine);
  const nextLines = [
    ...safeLines.slice(0, startLine),
    "",
    ...safeLines.slice(endLine),
  ];

  return {
    lines: ensureLines(nextLines),
    cursor: { line: startLine, col: 0 },
    text: `${removed.join("\n")}\n`,
  };
}

export function yankLineRange(
  lines: readonly string[],
  point: BufferPoint,
  count = 1,
): string {
  const safeLines = ensureLines(lines);
  const cursor = clampPoint(safeLines, point);
  const endLine = Math.min(safeLines.length, cursor.line + Math.max(1, count));
  return `${safeLines.slice(cursor.line, endLine).join("\n")}\n`;
}

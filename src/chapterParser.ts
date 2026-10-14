import type { ChapterIndex } from './types';

export const MAX_CHAPTER_LENGTH = 100_000;
export const CHAPTER_PATTERN = /^[\t \u3000]*第[零〇一二三四五六七八九十百千万两\d]+[章回节卷部篇集][^\r\n]*$/;

interface ChapterStart {
  title: string;
  index: number;
}

export function isChapterTitle(line: string): boolean {
  return CHAPTER_PATTERN.test(line);
}

/**
 * Builds UTF-16 string offsets so the stored indexes can be used directly by
 * String.prototype.slice after the UTF-8 content has been loaded.
 */
export function buildChapterIndex(content: string): ChapterIndex[] {
  const matcher = new RegExp(CHAPTER_PATTERN.source, 'gm');
  const starts: ChapterStart[] = [];
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(content)) !== null) {
    starts.push({
      title: match[0].trim(),
      index: match.index,
    });
  }

  if (starts.length === 0) {
    return splitRange(content, 0, content.length, '全文');
  }

  const chapters: ChapterIndex[] = [];
  const firstHeadingIndex = starts[0].index;
  const hasForeword = firstHeadingIndex > 0
    && content.slice(0, firstHeadingIndex).trim().length > 0;

  if (hasForeword) {
    chapters.push(...splitRange(content, 0, firstHeadingIndex, '前言'));
  }

  for (let index = 0; index < starts.length; index += 1) {
    const current = starts[index];
    // Leading whitespace alone remains attached to the first chapter. Actual
    // text before the first recognized heading is indexed as a foreword.
    const start = index === 0 && !hasForeword ? 0 : current.index;
    const end = starts[index + 1]?.index ?? content.length;
    chapters.push(...splitRange(content, start, end, current.title));
  }

  return chapters;
}

function splitRange(content: string, start: number, end: number, title: string): ChapterIndex[] {
  if (end - start <= MAX_CHAPTER_LENGTH) {
    return [{ title, start, end }];
  }

  const parts: ChapterIndex[] = [];
  let cursor = start;
  let partNumber = 1;

  while (cursor < end) {
    let partEnd = Math.min(cursor + MAX_CHAPTER_LENGTH, end);

    if (partEnd < end) {
      const lineBreak = content.lastIndexOf('\n', partEnd - 1);
      if (lineBreak > cursor + Math.floor(MAX_CHAPTER_LENGTH / 2)) {
        partEnd = lineBreak + 1;
      }

      // Do not split a Unicode surrogate pair when a single very long line
      // forces a hard boundary.
      if (isHighSurrogate(content.charCodeAt(partEnd - 1))) {
        partEnd -= 1;
      }
    }

    parts.push({
      title: partNumber === 1 ? title : `${title}（${partNumber}）`,
      start: cursor,
      end: partEnd,
    });
    cursor = partEnd;
    partNumber += 1;
  }

  return parts;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

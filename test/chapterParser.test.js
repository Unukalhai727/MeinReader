const assert = require('node:assert/strict');
const test = require('node:test');
const { buildChapterIndex, isChapterTitle, MAX_CHAPTER_LENGTH } = require('../dist/chapterParser');

test('recognizes only supported whole-line chapter headings', () => {
  assert.equal(isChapterTitle('  第一百二十三章 山雨欲来'), true);
  assert.equal(isChapterTitle('第12回'), true);
  assert.equal(isChapterTitle('序章'), false);
  assert.equal(isChapterTitle('他说：第一章开始了'), false);
});

test('generates a full-text chapter when no heading exists', () => {
  const content = '第一段\n第二段';
  assert.deepEqual(buildChapterIndex(content), [{ title: '全文', start: 0, end: content.length }]);
});

test('keeps consecutive headings as separate chapters and includes heading lines', () => {
  const content = '第一章 起\n第二章 承\n正文';
  const chapters = buildChapterIndex(content);
  assert.equal(chapters.length, 2);
  assert.equal(content.slice(chapters[0].start, chapters[0].end), '第一章 起\n');
  assert.equal(content.slice(chapters[1].start, chapters[1].end), '第二章 承\n正文');
});

test('indexes non-empty text before the first recognized heading as a foreword', () => {
  const content = '作品说明\n第一章 开始\n内容';
  const chapters = buildChapterIndex(content);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, '前言');
  assert.equal(content.slice(chapters[0].start, chapters[0].end), '作品说明\n');
  assert.equal(content.slice(chapters[1].start, chapters[1].end), '第一章 开始\n内容');
});

test('does not create a foreword from leading whitespace alone', () => {
  const content = '\n　第一章 开始\n内容';
  const chapters = buildChapterIndex(content);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].start, 0);
});

test('force-splits chapters over the maximum length without losing content', () => {
  const content = `第一章 很长\n${'字'.repeat(MAX_CHAPTER_LENGTH * 2 + 7)}`;
  const chapters = buildChapterIndex(content);
  assert.equal(chapters.length, 3);
  assert.equal(chapters.map((chapter) => content.slice(chapter.start, chapter.end)).join(''), content);
  assert.ok(chapters.every((chapter) => chapter.end - chapter.start <= MAX_CHAPTER_LENGTH));
  assert.equal(chapters[1].title, '第一章 很长（2）');
});

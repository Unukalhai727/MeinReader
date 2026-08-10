const assert = require('node:assert/strict');
const test = require('node:test');
const { decodeAndNormalize, UnsupportedTextEncodingError } = require('../dist/textDecoder');

test('decodes UTF-8, removes BOM, and normalizes line endings', () => {
  const bytes = Buffer.from('\ufeff第一章\r\n正文\r末尾', 'utf8');
  assert.equal(decodeAndNormalize(bytes), '第一章\n正文\n末尾');
});

test('decodes GBK bytes through the GB18030 decoder', () => {
  const bytes = Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]);
  assert.equal(decodeAndNormalize(bytes), '第一章');
});

test('rejects explicitly unsupported UTF-16 text', () => {
  const bytes = Buffer.from([0xff, 0xfe, 0x2c, 0x7b]);
  assert.throws(() => decodeAndNormalize(bytes), UnsupportedTextEncodingError);
});

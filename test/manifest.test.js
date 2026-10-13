const assert = require('node:assert/strict');
const test = require('node:test');
const manifest = require('../package.json');

test('runs exclusively in the local UI extension host', () => {
  assert.deepEqual(manifest.extensionKind, ['ui']);
});

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_SETTINGS,
  READER_SETTING_DEFINITIONS,
  sanitizeReaderSettings,
} = require('../dist/types');

test('uses one definition for every reader setting', () => {
  assert.deepEqual(
    READER_SETTING_DEFINITIONS.map((definition) => definition.key).sort(),
    Object.keys(DEFAULT_SETTINGS).sort(),
  );
});

test('fills missing reader settings from defaults', () => {
  assert.deepEqual(sanitizeReaderSettings({}), DEFAULT_SETTINGS);
});

test('clamps reader settings to their supported ranges', () => {
  assert.deepEqual(sanitizeReaderSettings({
    fontSize: 100,
    fontWeight: 100,
    maxPageWidth: 2000,
    letterSpacing: -2,
    lineHeight: Number.NaN,
    paragraphSpacing: 99,
  }), {
    fontSize: 32,
    fontWeight: 250,
    maxPageWidth: 1600,
    letterSpacing: 0,
    lineHeight: DEFAULT_SETTINGS.lineHeight,
    paragraphSpacing: 24,
  });
});

test('preserves continuous variable-font weights', () => {
  assert.equal(sanitizeReaderSettings({ fontWeight: 537 }).fontWeight, 537);
});

import { TextDecoder } from 'node:util';

export class UnsupportedTextEncodingError extends Error {
  constructor() {
    super('无法按 UTF-8、GB18030 或 GBK 解码该文件。');
    this.name = 'UnsupportedTextEncodingError';
  }
}

export function decodeAndNormalize(buffer: Uint8Array): string {
  if (hasUtf16Bom(buffer)) {
    throw new UnsupportedTextEncodingError();
  }

  const encodings = ['utf-8', 'gb18030'] as const;

  for (const encoding of encodings) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: true });
      const decoded = decoder.decode(buffer);
      if (decoded.includes('\u0000')) {
        continue;
      }

      return normalizeText(decoded);
    } catch {
      // Try the next supported encoding.
    }
  }

  throw new UnsupportedTextEncodingError();
}

function normalizeText(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, '\n');
}

function hasUtf16Bom(buffer: Uint8Array): boolean {
  return buffer.length >= 2 && (
    (buffer[0] === 0xff && buffer[1] === 0xfe)
    || (buffer[0] === 0xfe && buffer[1] === 0xff)
  );
}

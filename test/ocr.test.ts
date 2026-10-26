import { describe, expect, it } from 'vitest';
import { ocrImage } from '../src/ocr.js';

const fixture = new URL('./fixtures/hello-zh-en.png', import.meta.url).pathname;

describe('ocrImage', () => {
  it('reads english text from the fixture', async () => {
    expect((await ocrImage(fixture, 'eng')).toLowerCase()).toContain('hello');
  });
  it('throws for a missing file', async () => {
    await expect(ocrImage('/nonexistent/x.png', 'eng')).rejects.toThrow();
  });
  it('names tesseract in the error when it is not on PATH', async () => {
    const old = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      await expect(ocrImage(fixture, 'eng')).rejects.toThrow(/tesseract/);
    } finally {
      process.env.PATH = old;
    }
  });
});

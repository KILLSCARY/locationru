import { MagicBytesFileTypeDetector } from './magic-bytes-file-type-detector.js';

describe('MagicBytesFileTypeDetector', () => {
  const detector = new MagicBytesFileTypeDetector();

  it('detects a JPEG and matches when declared as image/jpeg', async () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);

    const result = await detector.detect(buffer, 'image/jpeg');

    expect(result).toEqual({
      detectedMimeType: 'image/jpeg',
      matchesDeclaredType: true,
    });
  });

  it('detects a PNG and matches when declared as image/png', async () => {
    const buffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);

    const result = await detector.detect(buffer, 'image/png');

    expect(result).toEqual({
      detectedMimeType: 'image/png',
      matchesDeclaredType: true,
    });
  });

  it('detects a PDF and matches when declared as application/pdf', async () => {
    const buffer = Buffer.from('%PDF-1.4\n...');

    const result = await detector.detect(buffer, 'application/pdf');

    expect(result).toEqual({
      detectedMimeType: 'application/pdf',
      matchesDeclaredType: true,
    });
  });

  it('flags a mismatch when the declared MIME type disagrees with the detected signature', async () => {
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

    const result = await detector.detect(jpegBytes, 'application/pdf');

    expect(result).toEqual({
      detectedMimeType: 'image/jpeg',
      matchesDeclaredType: false,
    });
  });

  it('rejects a Windows PE executable renamed with an allowed declared MIME type', async () => {
    const exeBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);

    const result = await detector.detect(exeBytes, 'image/jpeg');

    expect(result).toEqual({
      detectedMimeType: null,
      matchesDeclaredType: false,
    });
  });

  it('rejects a ZIP/Office archive signature outright', async () => {
    const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

    const result = await detector.detect(zipBytes, 'application/pdf');

    expect(result).toEqual({
      detectedMimeType: null,
      matchesDeclaredType: false,
    });
  });

  it('rejects an ELF executable outright', async () => {
    const elfBytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);

    const result = await detector.detect(elfBytes, 'image/png');

    expect(result.matchesDeclaredType).toBe(false);
  });

  it('rejects SVG/XML content even when declared as an allowed image type', async () => {
    const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />');

    const result = await detector.detect(svgBytes, 'image/png');

    expect(result).toEqual({
      detectedMimeType: null,
      matchesDeclaredType: false,
    });
  });

  it('rejects an XML declaration disguised as an image', async () => {
    const xmlBytes = Buffer.from('<?xml version="1.0"?><root/>');

    const result = await detector.detect(xmlBytes, 'image/jpeg');

    expect(result.matchesDeclaredType).toBe(false);
  });

  it('treats unrecognized bytes as an unmatched, undetected type rather than throwing', async () => {
    const randomBytes = Buffer.from([0x01, 0x02, 0x03, 0x04]);

    const result = await detector.detect(randomBytes, 'image/jpeg');

    expect(result).toEqual({
      detectedMimeType: null,
      matchesDeclaredType: false,
    });
  });

  it('detects an SVG even with a leading UTF-8 BOM', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const svgBytes = Buffer.concat([bom, Buffer.from('<svg></svg>')]);

    const result = await detector.detect(svgBytes, 'image/png');

    expect(result.matchesDeclaredType).toBe(false);
  });
});

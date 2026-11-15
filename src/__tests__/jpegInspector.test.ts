import { describe, expect, it } from "vitest";
import { inspectJpeg, isUploadableJpeg } from "../imaging/jpegInspector";

/**
 * Builds a synthetic minimal JPEG byte stream containing SOI + optional APP0 + SOF0/SOF2 + EOI.
 */
function buildTestJpeg(sofMarker: 0xc0 | 0xc2, width: number, height: number, extraPadFf = false): Uint8Array {
  const bytes: number[] = [
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46, // short APP0 filler (len=6 => +6)
  ];
  if (extraPadFf) {
    bytes.push(0xff, 0xff); // duplicate 0xFF padding bytes
  }
  bytes.push(
    0xff,
    sofMarker,
    0x00,
    0x0b, // segment length
    0x08, // 8-bit sample precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0xff,
    0xd9 // EOI
  );
  return new Uint8Array(bytes);
}

describe("jpegInspector", () => {
  it("accepts Baseline JPEG (SOF0) and extracts exact dimensions", () => {
    const jpeg = buildTestJpeg(0xc0, 240, 240);
    const res = inspectJpeg(jpeg);
    expect(res).toEqual({
      valid: true,
      baseline: true,
      width: 240,
      height: 240,
      markerType: "SOF0",
    });
    expect(isUploadableJpeg(res, 240, 240)).toBe(true);
    expect(isUploadableJpeg(res, 128, 128)).toBe(false);
  });

  it("handles padded 0xFF marker prefixes cleanly", () => {
    const jpeg = buildTestJpeg(0xc0, 240, 240, true);
    const res = inspectJpeg(jpeg);
    expect(res.valid).toBe(true);
    expect(res.baseline).toBe(true);
  });

  it("rejects Progressive JPEG (SOF2)", () => {
    const jpeg = buildTestJpeg(0xc2, 240, 240);
    const res = inspectJpeg(jpeg);
    expect(res.valid).toBe(true);
    expect(res.baseline).toBe(false);
    expect(res.markerType).toBe("SOF2");
    expect(res.errorCode).toBe("progressive_sof2");
    expect(isUploadableJpeg(res, 240, 240)).toBe(false);
  });

  it("rejects non-JPEG headers with missing_soi", () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const res = inspectJpeg(pngHeader);
    expect(res.valid).toBe(false);
    expect(res.errorCode).toBe("missing_soi");
  });

  it("rejects empty SOI/EOI streams missing SOF0", () => {
    const res = inspectJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    expect(res.valid).toBe(false);
    expect(res.errorCode).toBe("missing_sof0");
  });
});

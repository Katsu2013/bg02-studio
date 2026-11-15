import { describe, expect, it } from "vitest";
import {
  clampRelativeScale,
  computeContainRelativeScale,
  computeCoverScale,
  normalizeRotationDeg,
} from "../imaging/badgeCompositor";
import { resolveTargetGeometry } from "../main";
import type { ClockDialInfo } from "../ble/types";

describe("badgeCompositor transform & geometry math", () => {
  it("normalizes arbitrary angles symmetrically into [-180, 180]", () => {
    expect(normalizeRotationDeg(0)).toBe(0);
    expect(normalizeRotationDeg(360)).toBe(0);
    expect(normalizeRotationDeg(270)).toBe(-90);
    expect(normalizeRotationDeg(-270)).toBe(90);
    expect(normalizeRotationDeg(180)).toBe(180);
  });

  it("computes accurate Cover and Contain relative scales", () => {
    // 800x400 image into 240x240: Cover = max(240/800=0.3, 240/400=0.6) = 0.6
    expect(computeCoverScale(800, 400, 240, 240)).toBeCloseTo(0.6);
    // Contain = min(0.3, 0.6) = 0.3 => relative to Cover = 0.5
    expect(computeContainRelativeScale(800, 400, 240, 240)).toBeCloseTo(0.5);

    // Square image has Cover == Contain => relative scale 1.0
    expect(computeContainRelativeScale(500, 500, 240, 240)).toBeCloseTo(1.0);
  });

  it("clamps relative zoom values safely", () => {
    expect(clampRelativeScale(0.01)).toBe(0.25);
    expect(clampRelativeScale(20)).toBe(5.0);
    expect(clampRelativeScale(Number.NaN)).toBe(1.0);
  });

  it("defaults target geometry to 240x240 round when dial info is absent", () => {
    expect(resolveTargetGeometry(null)).toEqual({ width: 240, height: 240, shape: "round" });

    const squareMock: ClockDialInfo = {
      screenType: 0,
      shape: "square",
      grade: 0,
      width: 320,
      height: 320,
      mchModel: "K66",
      mainModel: "LJ733",
      config: 7,
      algorithm: 4,
      algorithmName: "JPEG (4)",
      versionCode: 0,
      customer: "TEST",
      pictureNums: 0,
      watchThemeVersion: 9,
      watchThemeShortPkgLength: 5000,
      thumbWidth: null,
      thumbHeight: null,
    };
    expect(resolveTargetGeometry(squareMock)).toEqual({
      width: 320,
      height: 320,
      shape: "square",
    });
  });
});

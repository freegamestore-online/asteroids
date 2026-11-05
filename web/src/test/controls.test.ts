import { describe, it, expect, vi } from "vitest";
import { controlForKey, touchRegion, sizeCanvas } from "../components/Game";

describe("controlForKey", () => {
  it("maps arrows, WASD and Space regardless of case", () => {
    expect(controlForKey("ArrowLeft")).toBe("left");
    expect(controlForKey("a")).toBe("left");
    expect(controlForKey("A")).toBe("left");
    expect(controlForKey("D")).toBe("right");
    expect(controlForKey("W")).toBe("thrust");
    expect(controlForKey(" ")).toBe("shoot");
    expect(controlForKey("x")).toBeUndefined();
  });
});

describe("touchRegion", () => {
  it("splits sides for rotation and the centre into thrust above fire", () => {
    expect(touchRegion(0.1, 0.9)).toBe("left");
    expect(touchRegion(0.9, 0.1)).toBe("right");
    expect(touchRegion(0.5, 0.2)).toBe("thrust");
    expect(touchRegion(0.5, 0.8)).toBe("shoot");
  });
});

describe("sizeCanvas", () => {
  it("sizes the backing store in device pixels and scales drawing to CSS pixels", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const canvas = document.createElement("canvas");
    const setTransform = vi.fn();
    sizeCanvas(canvas, { setTransform } as unknown as CanvasRenderingContext2D, 300, 200);
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(400);
    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    vi.unstubAllGlobals();
  });
});

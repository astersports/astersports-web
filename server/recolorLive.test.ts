/**
 * A2 deterministic recolor helper test. Verifies generateRecoloredImage resolves
 * the source URL, runs the classical fabric mask + separationRemap with the given
 * params, and returns the op's PNG bytes. Provider/op/storage are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/masking", () => ({ getMaskProvider: vi.fn() }));
vi.mock("./_core/studio/ops/separationRemap", () => ({ separationRemap: vi.fn() }));
vi.mock("./storage", () => ({ storageGetSignedUrl: vi.fn() }));

import { getMaskProvider } from "./_core/masking";
import { separationRemap } from "./_core/studio/ops/separationRemap";
import { storageGetSignedUrl } from "./storage";
import { generateRecoloredImage } from "./aiEngine";

const mockProvider = getMaskProvider as unknown as ReturnType<typeof vi.fn>;
const mockRemap = separationRemap as unknown as ReturnType<typeof vi.fn>;
const mockSign = storageGetSignedUrl as unknown as ReturnType<typeof vi.fn>;

const fabric = { bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1, provider: "classical" };
const params = { fromColor: "#abcdef", toColor: "#123456", coverage: 80 };

beforeEach(() => {
  vi.clearAllMocks();
  mockProvider.mockReturnValue({ getFabricMask: vi.fn().mockResolvedValue(fabric) });
});

describe("generateRecoloredImage", () => {
  it("signs a /manus-storage url, runs separationRemap, returns the PNG", async () => {
    mockSign.mockResolvedValue("https://signed/x.jpg");
    const png = Buffer.from([1, 2, 3]);
    mockRemap.mockResolvedValue(png);

    const out = await generateRecoloredImage("/manus-storage/k.jpg", params);

    expect(out).toBe(png);
    expect(mockSign).toHaveBeenCalledWith("k.jpg");
    expect(mockRemap).toHaveBeenCalledWith({ url: "https://signed/x.jpg" }, fabric, params);
  });

  it("passes a non-storage url through unsigned", async () => {
    mockRemap.mockResolvedValue(Buffer.from([9]));
    await generateRecoloredImage("https://x/y.png", params);
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockRemap).toHaveBeenCalledWith({ url: "https://x/y.png" }, fabric, params);
  });
});

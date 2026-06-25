import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase storage layer so these tests exercise the adapter logic
// (key suffixing, upsert choice, /manus-storage path, signed-URL TTL) without a
// network round-trip or credentials.
const { mockUpload, mockFrom, mockCreateSignedUrl } = vi.hoisted(() => {
  const mockUpload = vi.fn();
  return { mockUpload, mockFrom: vi.fn(() => ({ upload: mockUpload })), mockCreateSignedUrl: vi.fn() };
});

vi.mock("./_core/supabaseStorage", () => ({
  getStorageClient: () => ({ storage: { from: mockFrom } }),
  createStorageSignedUrl: mockCreateSignedUrl,
}));
vi.mock("./_core/env", () => ({ ENV: { supabaseStorageBucket: "media" } }));

import { storagePut, storageGet, storageGetSignedUrl } from "./storage";

describe("storage (Supabase adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpload.mockResolvedValue({ data: { path: "x" }, error: null });
    mockCreateSignedUrl.mockResolvedValue("https://project.supabase.co/storage/v1/object/sign/media/x");
  });

  it("storagePut: random-suffix key (before the extension), no upsert, /manus-storage path", async () => {
    const res = await storagePut("studio/1/orig.png", Buffer.from("bytes"), "image/png");

    expect(mockFrom).toHaveBeenCalledWith("media");
    const [key, body, opts] = mockUpload.mock.calls[0];
    expect(key).toMatch(/^studio\/1\/orig_[0-9a-f]{8}\.png$/);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(opts).toEqual({ contentType: "image/png", upsert: false });
    expect(res).toEqual({ key, url: `/manus-storage/${key}` });
  });

  it("storagePut: deterministicKey keeps the exact key and upserts (content-addressed cache)", async () => {
    const res = await storagePut("generated/cache-abc.png", Buffer.from("bytes"), "image/png", {
      deterministicKey: true,
    });
    const [key, , opts] = mockUpload.mock.calls[0];
    expect(key).toBe("generated/cache-abc.png"); // no suffix — write addr == read addr
    expect(opts.upsert).toBe(true);
    expect(res.url).toBe("/manus-storage/generated/cache-abc.png");
  });

  it("storagePut: surfaces a backend error", async () => {
    mockUpload.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(storagePut("k.png", Buffer.from("x"))).rejects.toThrow(/Storage upload failed: boom/);
  });

  it("storageGet: returns the serving path with no network call", async () => {
    const res = await storageGet("/studio/1/x.png");
    expect(res).toEqual({ key: "studio/1/x.png", url: "/manus-storage/studio/1/x.png" });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("storageGetSignedUrl: signs the normalized key with a 1-hour TTL", async () => {
    const url = await storageGetSignedUrl("/studio/1/x.png");
    expect(mockCreateSignedUrl).toHaveBeenCalledWith("studio/1/x.png", 3600);
    expect(url).toBe("https://project.supabase.co/storage/v1/object/sign/media/x");
  });
});

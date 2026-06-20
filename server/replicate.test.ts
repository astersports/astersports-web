import { describe, it, expect } from "vitest";

describe("Replicate API Token Validation", () => {
  it("can authenticate with Replicate API", async () => {
    const token = process.env.REPLICATE_API_TOKEN;
    expect(token).toBeDefined();
    expect(token!.startsWith("r8_")).toBe(true);

    // Call the Replicate API account endpoint to verify token validity
    const response = await fetch("https://api.replicate.com/v1/account", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("username");
  });
});

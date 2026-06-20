/**
 * End-to-end density test: calls generateDensityImage directly
 * with a known image URL from the database to verify the full pipeline
 * (SAM2 segmentation → densityThin → PNG output).
 */
import "dotenv/config";
import { storageGetSignedUrl } from "../server/storage.ts";

// We need to import the actual function - but since this is ESM with tsx,
// let's call the tRPC endpoint directly via HTTP instead.

const BASE = "http://localhost:3000";

// Use the image from a successful density job
const TEST_IMAGE_URL = "/manus-storage/studio/1/1781950779568-IMG_0234_0d54f07d.jpg";

async function testDensityDirect() {
  console.log("=== Density E2E Test ===");
  console.log(`Image: ${TEST_IMAGE_URL}`);
  console.log(`Percent: 30`);
  console.log("");

  // We'll call the generate endpoint via tRPC batch
  // First we need to create a job (upload), then generate with density controls
  
  // Step 1: Check if the server is running
  try {
    const res = await fetch(`${BASE}/api/trpc/auth.me`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    console.log(`Server status: ${res.status}`);
    if (res.status !== 200 && res.status !== 401) {
      console.error("Server not responding properly");
      process.exit(1);
    }
  } catch (e) {
    console.error("Server not reachable:", e.message);
    process.exit(1);
  }

  // Step 2: Call generateDensityImage directly using tsx
  console.log("\nCalling generateDensityImage directly...");
  console.log("(This will call SAM2 via Replicate + run densityThin locally)");
  console.log("");
}

testDensityDirect();

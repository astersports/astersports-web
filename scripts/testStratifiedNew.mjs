// Test the actual stratifiedSelect implementation
import { stratifiedSelect } from "../server/_core/studio/ops/stratifiedSelect.ts";

// Test 1: 4x4 grid (16 instances), removeN=4
console.log("=== Test 1: 4x4 grid, removeN=4 ===");
const grid16 = [];
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    grid16.push({ bbox: { x: (col + 0.4) / 4, y: (row + 0.4) / 4, w: 0.05, h: 0.05 } });
  }
}
const FB = { x: 0, y: 0, w: 1, h: 1 };
const sel4 = stratifiedSelect(grid16, 4, FB, 100, 100);
console.log("Removed:", sel4);
const quad = (i) => (Math.floor(i / 4) < 2 ? 0 : 2) + (i % 4 < 2 ? 0 : 1);
console.log("Removed quadrants:", sel4.map(quad));
console.log("Unique quadrants:", new Set(sel4.map(quad)).size);
console.log("Layout:");
for (let row = 0; row < 4; row++) {
  let line = "  ";
  for (let col = 0; col < 4; col++) {
    const idx = row * 4 + col;
    line += sel4.includes(idx) ? "R " : "K ";
  }
  console.log(line);
}

// Test 2: 6x6 grid (36 instances), removeN=11
console.log("\n=== Test 2: 6x6 grid, removeN=11 ===");
const N = 6, P = 20, OFF = 10, W = 128, H = 128;
const F0 = 6, F1 = 122;
const grid36 = [];
for (let row = 0; row < N; row++) {
  for (let col = 0; col < N; col++) {
    const cx = OFF + col * P, cy = OFF + row * P;
    grid36.push({ bbox: { x: (cx - 8) / W, y: (cy - 8) / H, w: 17 / W, h: 17 / H } });
  }
}
const FB2 = { x: F0 / W, y: F0 / H, w: (F1 - F0) / W, h: (F1 - F0) / H };
const sel11 = stratifiedSelect(grid36, 11, FB2, W, H);
console.log("Removed:", sel11.length, sel11);
console.log("Layout:");
for (let row = 0; row < N; row++) {
  let line = "  ";
  for (let col = 0; col < N; col++) {
    const idx = row * N + col;
    line += sel11.includes(idx) ? "R " : "K ";
  }
  console.log(line);
}

// Test 3: 6x6 grid, removeN=18 (50%)
console.log("\n=== Test 3: 6x6 grid, removeN=18 (50%) ===");
const sel18 = stratifiedSelect(grid36, 18, FB2, W, H);
console.log("Removed:", sel18.length, sel18);
console.log("Layout:");
for (let row = 0; row < N; row++) {
  let line = "  ";
  for (let col = 0; col < N; col++) {
    const idx = row * N + col;
    line += sel18.includes(idx) ? "R " : "K ";
  }
  console.log(line);
}

// Determinism check
const sel18b = stratifiedSelect(grid36, 18, FB2, W, H);
console.log("\nDeterministic:", JSON.stringify(sel18) === JSON.stringify(sel18b));

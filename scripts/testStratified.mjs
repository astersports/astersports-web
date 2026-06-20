// Simulate the new stratifiedSelect on the 4x4 grid with removeN=4
const grid = [];
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    grid.push({ bbox: { x: (col + 0.4) / 4, y: (row + 0.4) / 4, w: 0.05, h: 0.05 } });
  }
}

const n = 16, removeN = 4, keepN = 12;
const W = 100, H = 100;
const bx = 0, by = 0, bw = 100, bh = 100;
const aspect = bw / bh;
const cols = Math.max(1, Math.round(Math.sqrt(keepN * aspect)));
const rows = Math.max(1, Math.ceil(keepN / cols));
console.log('Grid for keepN=12:', cols, 'x', rows, '=', cols * rows, 'cells');

// Centroid for each instance
const cents = grid.map(inst => [(inst.bbox.x + inst.bbox.w / 2) * W, (inst.bbox.y + inst.bbox.h / 2) * H]);

// Bucket
const cells = new Map();
for (let i = 0; i < n; i++) {
  const gx = Math.min(cols - 1, Math.max(0, Math.floor((cents[i][0] - bx) / bw * cols)));
  const gy = Math.min(rows - 1, Math.max(0, Math.floor((cents[i][1] - by) / bh * rows)));
  const key = gy * cols + gx;
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(i);
}
console.log('Cells:', cells.size);
for (const [k, v] of cells) console.log('  cell', k, ':', v);

// Pick keepN survivors (nearest to cell center first)
const order = Array.from(cells.keys()).sort((a, b) => a - b);
const keepSet = new Set();
for (let r = 0; keepSet.size < keepN; r++) {
  let progressed = false;
  for (const key of order) {
    const list = cells.get(key);
    if (r < list.length) {
      keepSet.add(list[r]);
      progressed = true;
      if (keepSet.size >= keepN) break;
    }
  }
  if (!progressed) break;
}
console.log('Keep:', [...keepSet].sort((a, b) => a - b));
const removed = [];
for (let i = 0; i < n; i++) {
  if (!keepSet.has(i)) removed.push(i);
}
console.log('Removed:', removed);

// Check quadrants of removed
const quad = (i) => (Math.floor(i / 4) < 2 ? 0 : 2) + (i % 4 < 2 ? 0 : 1);
console.log('Removed quadrants:', removed.map(quad));
console.log('Unique quadrants:', new Set(removed.map(quad)).size);

// Also show the spatial positions of removed vs kept
console.log('\nSpatial layout (K=keep, R=remove):');
for (let row = 0; row < 4; row++) {
  let line = '';
  for (let col = 0; col < 4; col++) {
    const idx = row * 4 + col;
    line += removed.includes(idx) ? 'R ' : 'K ';
  }
  console.log('  ' + line);
}

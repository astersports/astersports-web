// Full simulation of the 36-instance case (6x6 grid)
const n = 36, removeN = 11, keepN = 25;
const W = 128, H = 128, P = 20, OFF = 10, N = 6, R = 8;
const F0 = 6, F1 = 122;
const bx = F0, by = F0, bw = F1 - F0, bh = F1 - F0;
const aspect = bw / bh;
const cols = Math.max(1, Math.round(Math.sqrt(keepN * aspect)));
const rows = Math.max(1, Math.ceil(keepN / cols));
const cellW = bw / cols, cellH = bh / rows;
console.log('Grid for keepN=25:', cols, 'x', rows, '=', cols * rows, 'cells');
console.log('Each cell:', cellW.toFixed(1), 'x', cellH.toFixed(1), 'px');
console.log('Instance spacing:', P, 'px');

// Instance centroids (center of each circle)
const cents = [];
for (let row = 0; row < N; row++) {
  for (let col = 0; col < N; col++) {
    cents.push([OFF + col * P, OFF + row * P]);
  }
}

// Bucket
const cells = new Map();
for (let i = 0; i < n; i++) {
  const gx = Math.min(cols - 1, Math.max(0, Math.floor((cents[i][0] - bx) / bw * cols)));
  const gy = Math.min(rows - 1, Math.max(0, Math.floor((cents[i][1] - by) / bh * rows)));
  const key = gy * cols + gx;
  const list = cells.get(key);
  if (list) { list.push(i); } else { cells.set(key, [i]); }
}

console.log('Cells occupied:', cells.size);
for (const [k, v] of cells) {
  const gx = k % cols, gy = Math.floor(k / cols);
  console.log(`  cell [${gy},${gx}] (key=${k}): instances ${v}`);
}

// Sort within each cell by distance to cell center
for (const [key, list] of cells) {
  const gx = key % cols, gy = Math.floor(key / cols);
  const ccx = bx + (gx + 0.5) * cellW, ccy = by + (gy + 0.5) * cellH;
  list.sort((a, b) => {
    const da = (cents[a][0] - ccx) ** 2 + (cents[a][1] - ccy) ** 2;
    const db = (cents[b][0] - ccx) ** 2 + (cents[b][1] - ccy) ** 2;
    return da - db || a - b;
  });
}

// Pick keepN survivors
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
  if (progressed === false) break;
}

const removed = [];
for (let i = 0; i < n; i++) {
  if (keepSet.has(i) === false) removed.push(i);
}
console.log('\nRemoved:', removed.length, removed);
console.log('Keep:', [...keepSet].sort((a, b) => a - b));

// Show spatial layout
console.log('\nLayout (K=keep, R=remove):');
for (let row = 0; row < N; row++) {
  let line = '';
  for (let col = 0; col < N; col++) {
    const idx = row * N + col;
    line += removed.includes(idx) ? 'R ' : 'K ';
  }
  console.log('  ' + line);
}

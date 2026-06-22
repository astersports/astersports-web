/**
 * Largest-connected-component bbox for a binary fabric raster.
 *
 * Denoises SAM2 mask artifacts (rogue islands / specks) before the scale op
 * derives its bbox: a global min/max scan lets a single disconnected speck
 * inflate the bbox and skew the center-crop / mirror-tile geometry.
 *
 * Iterative BFS over the 1D raster with a flat Uint32Array frontier (no
 * recursion -> no stack overflow on large masks; ~5 B/px transient, freed on
 * return). Deterministic: raster scan order; ties (equal area) keep the first
 * found. 4-connectivity. Returns null when the mask is empty.
 *
 * On a clean single-component mask this returns the same bbox as a global
 * min/max scan, so it is a no-op for contiguous masks.
 */
export interface ComponentBBox {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

export function largestComponentBBox(
  raster: Uint8Array,
  width: number,
  height: number,
  threshold = 127
): ComponentBBox | null {
  const n = width * height;
  const visited = new Uint8Array(n);
  const frontier = new Uint32Array(n); // reused across components; max size = n
  let maxArea = 0;
  let best: ComponentBBox | null = null;

  for (let start = 0; start < n; start++) {
    if (raster[start] <= threshold || visited[start]) continue;

    let head = 0;
    let tail = 0;
    frontier[tail++] = start;
    visited[start] = 1;

    let area = 0;
    const sx = start % width;
    const sy = (start / width) | 0;
    let cXmin = sx, cXmax = sx, cYmin = sy, cYmax = sy;

    while (head < tail) {
      const idx = frontier[head++];
      const x = idx % width;
      const y = (idx / width) | 0;
      area++;
      if (x < cXmin) cXmin = x;
      if (x > cXmax) cXmax = x;
      if (y < cYmin) cYmin = y;
      if (y > cYmax) cYmax = y;

      if (x > 0)          { const j = idx - 1;     if (raster[j] > threshold && !visited[j]) { visited[j] = 1; frontier[tail++] = j; } }
      if (x < width - 1)  { const j = idx + 1;     if (raster[j] > threshold && !visited[j]) { visited[j] = 1; frontier[tail++] = j; } }
      if (y > 0)          { const j = idx - width; if (raster[j] > threshold && !visited[j]) { visited[j] = 1; frontier[tail++] = j; } }
      if (y < height - 1) { const j = idx + width; if (raster[j] > threshold && !visited[j]) { visited[j] = 1; frontier[tail++] = j; } }
    }

    if (area > maxArea) {
      maxArea = area;
      best = { xmin: cXmin, xmax: cXmax, ymin: cYmin, ymax: cYmax };
    }
  }

  return best; // null when the mask is empty
}

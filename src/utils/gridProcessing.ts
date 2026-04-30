import { type PixelData } from './imageProcessing';

/**
 * mergeStrayBeads:
 * - Merges small connected components ("islands") of the same color into surrounding colors.
 * - Suppresses globally-rare colors to reduce anti-aliasing noise and total palette size.
 */
export function mergeStrayBeads(grid: PixelData[][], minSize: number): PixelData[][] {
  if (grid.length === 0) return grid;
  if (minSize <= 1) return grid;

  const height = grid.length;
  const width = grid[0].length;

  // Use 8-neighborhood to treat diagonal speckles as a single island.
  const neighbors8: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  // A few iterations helps collapse multi-step islands (A->B->C).
  const maxIterations = 3;
  let current: PixelData[][] = grid.map((row) => row.map((p) => ({ ...p })));

  for (let iter = 0; iter < maxIterations; iter++) {
    // Count total occurrences of each color (for global rare-color suppression)
    const totalCounts: Record<string, number> = {};
    for (const row of current) {
      for (const p of row) totalCounts[p.color.id] = (totalCounts[p.color.id] || 0) + 1;
    }

    // Dynamic rare threshold: at least 2*minSize, capped by 1% of grid.
    const area = width * height;
    const rareColorThreshold = Math.min(Math.max(2 * minSize, 6), Math.max(6, Math.floor(area * 0.01)));
    const rareColorIds = new Set(Object.keys(totalCounts).filter((id) => totalCounts[id] < rareColorThreshold));

    const visited = Array.from({ length: height }, () => new Uint8Array(width));
    const next: PixelData[][] = current.map((row) => row.map((p) => ({ ...p })));
    let changed = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (visited[y][x]) continue;

        const baseColor = current[y][x].color;
        const baseId = baseColor.id;
        const component: { x: number; y: number }[] = [];
        const queue: [number, number][] = [[x, y]];
        visited[y][x] = 1;

        // BFS to find connected component (non-recursive)
        for (let head = 0; head < queue.length; head++) {
          const [cx, cy] = queue[head];
          component.push({ x: cx, y: cy });

          for (const [dx, dy] of neighbors8) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (visited[ny][nx]) continue;
            if (current[ny][nx].color.id !== baseId) continue;
            visited[ny][nx] = 1;
            queue.push([nx, ny]);
          }
        }

        const isRareColor = rareColorIds.has(baseId);
        if (component.length >= minSize && !isRareColor) continue;

        // Count adjacent colors (prefer non-rare, and prefer more contact area)
        const neighborCounts = new Map<string, { color: PixelData['color']; score: number }>();
        for (const pos of component) {
          for (const [dx, dy] of neighbors8) {
            const nx = pos.x + dx;
            const ny = pos.y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const nColor = current[ny][nx].color;
            if (nColor.id === baseId) continue;

            const penalty = rareColorIds.has(nColor.id) ? 0.15 : 1;
            const entry = neighborCounts.get(nColor.id);
            if (entry) entry.score += penalty;
            else neighborCounts.set(nColor.id, { color: nColor, score: penalty });
          }
        }

        // Pick best neighbor by highest score; if tie-ish, pick the closest in LAB.
        let best: { color: PixelData['color']; score: number } | null = null;
        for (const entry of neighborCounts.values()) {
          if (!best) {
            best = entry;
            continue;
          }
          if (entry.score > best.score + 1e-6) {
            best = entry;
            continue;
          }
          if (Math.abs(entry.score - best.score) <= 1e-6) {
            const dl1 =
              (entry.color.lab.l - baseColor.lab.l) ** 2 +
              (entry.color.lab.a - baseColor.lab.a) ** 2 +
              (entry.color.lab.b - baseColor.lab.b) ** 2;
            const dl2 =
              (best.color.lab.l - baseColor.lab.l) ** 2 +
              (best.color.lab.a - baseColor.lab.a) ** 2 +
              (best.color.lab.b - baseColor.lab.b) ** 2;
            if (dl1 < dl2) best = entry;
          }
        }

        if (!best) continue;

        for (const pos of component) {
          if (next[pos.y][pos.x].color.id !== best.color.id) {
            next[pos.y][pos.x].color = best.color;
            changed = true;
          }
        }
      }
    }

    current = next;
    if (!changed) break;
  }

  return current;
}

export function fillSmallColorIslands(
  grid: PixelData[][],
  targetColorIds: ReadonlySet<string>,
  maxIslandSize: number,
): PixelData[][] {
  if (grid.length === 0) return grid;
  if (maxIslandSize <= 0) return grid;

  const height = grid.length;
  const width = grid[0].length;

  const neighbors8: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  const visited = Array.from({ length: height }, () => new Uint8Array(width));
  const next: PixelData[][] = grid.map((row) => row.map((p) => ({ ...p })));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visited[y][x]) continue;
      const baseId = grid[y][x].color.id;
      if (!targetColorIds.has(baseId)) {
        visited[y][x] = 1;
        continue;
      }

      const component: { x: number; y: number }[] = [];
      const queue: [number, number][] = [[x, y]];
      visited[y][x] = 1;

      for (let head = 0; head < queue.length; head++) {
        const [cx, cy] = queue[head];
        component.push({ x: cx, y: cy });

        for (const [dx, dy] of neighbors8) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (visited[ny][nx]) continue;
          if (grid[ny][nx].color.id !== baseId) continue;
          visited[ny][nx] = 1;
          queue.push([nx, ny]);
        }
      }

      if (component.length > maxIslandSize) continue;

      // Merge into the most common neighboring non-target color
      const neighborCounts = new Map<string, { color: PixelData['color']; count: number }>();
      for (const pos of component) {
        for (const [dx, dy] of neighbors8) {
          const nx = pos.x + dx;
          const ny = pos.y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nColor = grid[ny][nx].color;
          if (nColor.id === baseId) continue;
          if (targetColorIds.has(nColor.id)) continue;
          const entry = neighborCounts.get(nColor.id);
          if (entry) entry.count += 1;
          else neighborCounts.set(nColor.id, { color: nColor, count: 1 });
        }
      }

      let best: { color: PixelData['color']; count: number } | null = null;
      for (const entry of neighborCounts.values()) {
        if (!best || entry.count > best.count) best = entry;
      }
      if (!best) continue;

      for (const pos of component) {
        next[pos.y][pos.x].color = best.color;
      }
    }
  }

  return next;
}

import fs from 'node:fs';

const inputPath =
  'C:/Users/HUANGHUN/.cursor/projects/d-edge-bead-pixel-pro/agent-tools/ecd9e94d-b92b-4cb8-a378-d21a2c768a91.txt';

const json = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const wanted = /^(A|B|C|D|E|F|G|H|M)(\d{2})$/;
const order = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, M: 8 };

const colors = [];
for (const [hex, mapping] of Object.entries(json)) {
  const m = wanted.exec(mapping.MARD);
  if (!m) continue;
  const letter = m[1];
  const num = String(parseInt(m[2], 10));
  const id = `${letter}${num}`;
  const h = hex.toUpperCase();
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  colors.push({ id, hex: h, r, g, b });
}

colors.sort((a, b) => {
  const ga = order[a.id[0]] ?? 999;
  const gb = order[b.id[0]] ?? 999;
  if (ga !== gb) return ga - gb;
  return parseInt(a.id.slice(1), 10) - parseInt(b.id.slice(1), 10);
});

if (colors.length !== 221) {
  throw new Error(`Expected 221 colors, got ${colors.length}`);
}

for (const c of colors) {
  process.stdout.write(
    `  { id: '${c.id}', name: '${c.id}', hex: '${c.hex}', r: ${c.r}, g: ${c.g}, b: ${c.b}, lab: rgbToLab(${c.r}, ${c.g}, ${c.b}) },\n`,
  );
}


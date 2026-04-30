// CIELAB and DeltaE 2000 color difference implementation

export interface LAB {
  l: number;
  a: number;
  b: number;
}

export function rgbToLab(r: number, g: number, b: number): LAB {
  let r_l = r / 255;
  let g_l = g / 255;
  let b_l = b / 255;

  r_l = r_l > 0.04045 ? Math.pow((r_l + 0.055) / 1.055, 2.4) : r_l / 12.92;
  g_l = g_l > 0.04045 ? Math.pow((g_l + 0.055) / 1.055, 2.4) : g_l / 12.92;
  b_l = b_l > 0.04045 ? Math.pow((b_l + 0.055) / 1.055, 2.4) : b_l / 12.92;

  r_l *= 100;
  g_l *= 100;
  b_l *= 100;

  // Observer. = 2°, Illuminant = D65
  const x = r_l * 0.4124 + g_l * 0.3576 + b_l * 0.1805;
  const y = r_l * 0.2126 + g_l * 0.7152 + b_l * 0.0722;
  const z = r_l * 0.0193 + g_l * 0.1192 + b_l * 0.9505;

  let x_n = x / 95.047;
  let y_n = y / 100.0;
  let z_n = z / 108.883;

  x_n = x_n > 0.008856 ? Math.pow(x_n, 1 / 3) : 7.787 * x_n + 16 / 116;
  y_n = y_n > 0.008856 ? Math.pow(y_n, 1 / 3) : 7.787 * y_n + 16 / 116;
  z_n = z_n > 0.008856 ? Math.pow(z_n, 1 / 3) : 7.787 * z_n + 16 / 116;

  return {
    l: 116 * y_n - 16,
    a: 500 * (x_n - y_n),
    b: 200 * (y_n - z_n),
  };
}

export function deltaE2000(lab1: LAB, lab2: LAB): number {
  const L1 = lab1.l;
  const a1 = lab1.a;
  const b1 = lab1.b;
  const L2 = lab2.l;
  const a2 = lab2.a;
  const b2 = lab2.b;

  const avg_L = (L1 + L2) / 2;
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const avg_C = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Math.pow(avg_C, 7) / (Math.pow(avg_C, 7) + Math.pow(25, 7))));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const avg_Cp = (C1p + C2p) / 2;

  const h1p = Math.atan2(b1, a1p) >= 0 ? Math.atan2(b1, a1p) : Math.atan2(b1, a1p) + 2 * Math.PI;
  const h2p = Math.atan2(b2, a2p) >= 0 ? Math.atan2(b2, a2p) : Math.atan2(b2, a2p) + 2 * Math.PI;

  let avg_hp = Math.abs(h1p - h2p) > Math.PI ? (h1p + h2p + 2 * Math.PI) / 2 : (h1p + h2p) / 2;

  const T = 1 - 0.17 * Math.cos(avg_hp - Math.PI / 6) + 0.24 * Math.cos(2 * avg_hp) + 0.32 * Math.cos(3 * avg_hp + Math.PI / 30) - 0.2 * Math.cos(4 * avg_hp - 63 * Math.PI / 180);

  const diff_hp = Math.abs(h2p - h1p) <= Math.PI ? h2p - h1p : h2p - h1p <= -Math.PI ? h2p - h1p + 2 * Math.PI : h2p - h1p - 2 * Math.PI;

  const delta_Lp = L2 - L1;
  const delta_Cp = C2p - C1p;
  const delta_Hp = 2 * Math.sqrt(C1p * C2p) * Math.sin(diff_hp / 2);

  const Sl = 1 + (0.015 * Math.pow(avg_L - 50, 2)) / Math.sqrt(20 + Math.pow(avg_L - 50, 2));
  const Sc = 1 + 0.045 * avg_Cp;
  const Sh = 1 + 0.015 * avg_Cp * T;

  const delta_ro = 30 * Math.exp(-Math.pow((avg_hp * 180 / Math.PI - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(avg_Cp, 7) / (Math.pow(avg_Cp, 7) + Math.pow(25, 7)));
  const Rt = -Rc * Math.sin(2 * delta_ro * Math.PI / 180);

  const kL = 1;
  const kC = 1;
  const kH = 1;

  const deltaE = Math.sqrt(
    Math.pow(delta_Lp / (kL * Sl), 2) +
    Math.pow(delta_Cp / (kC * Sc), 2) +
    Math.pow(delta_Hp / (kH * Sh), 2) +
    Rt * (delta_Cp / (kC * Sc)) * (delta_Hp / (kH * Sh))
  );

  return deltaE;
}

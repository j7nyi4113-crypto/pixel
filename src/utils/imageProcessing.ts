import { findNearestBeadColor, type BeadColor } from '../constants/beadColors';

export interface PixelData {
  color: BeadColor;
  x: number;
  y: number;
}

export async function processImage(
  file: File,
  targetWidth: number = 40,
  targetHeight: number = 40,
  saturationBoost: number = 1.2,
  contrastBoost: number = 1.15,
  useDithering: boolean = false,
  preserveInkOutlines: boolean = false,
  palette: '221' | '291' = '221'
): Promise<PixelData[][]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      // 1. Pre-processing: Apply filters
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;
      tempCanvas.width = targetWidth;
      tempCanvas.height = targetHeight;

      // Apply Sharpness, Contrast and Saturation
      tempCtx.filter = `contrast(${contrastBoost}) saturate(${saturationBoost}) brightness(1.05)`;
      tempCtx.drawImage(img, 0, 0, targetWidth, targetHeight);

      const imageData = tempCtx.getImageData(0, 0, targetWidth, targetHeight);
      const data = imageData.data;

      // --- NEW: Line Binarization & Structural Pre-processing ---
      // We analyze brightness and force dark pixels to pure black (H7)
      // H7 is roughly [0, 0, 0]
      const colorCounts: Record<string, number> = {};

      // Estimate background color from corners (after filters).
      const corners: Array<[number, number]> = [
        [0, 0],
        [targetWidth - 1, 0],
        [0, targetHeight - 1],
        [targetWidth - 1, targetHeight - 1],
      ];
      let br = 0, bg = 0, bb = 0;
      for (const [cx, cy] of corners) {
        const idx = (cy * targetWidth + cx) * 4;
        br += data[idx];
        bg += data[idx + 1];
        bb += data[idx + 2];
      }
      br /= corners.length;
      bg /= corners.length;
      bb /= corners.length;

      const distToBg = (r: number, g: number, b: number) =>
        Math.sqrt((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2);
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        
        if (a < 128) continue; // Skip transparent

        // Calculate relative luminance
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        // Chroma heuristic: low value => near gray/line-art, high value => colored region (e.g., red cheeks)
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const chroma = (maxC - minC) / 255;
        
        // Optional: preserve ink-like outlines by forcing line-art to pure black.
        // Default is OFF to avoid misclassifying dark saturated colors (e.g. red cheeks) as black.
        if (preserveInkOutlines) {
          const shouldForceBlack = luminance < 0.18 || (luminance < 0.38 && chroma < 0.18);
          if (shouldForceBlack) {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            continue;
          }
        } else if (luminance > 0.92) {
          // Only force to white if it's likely background (close to corner background).
          // This prevents bright subject highlights (e.g., yellow crown) from becoming "blank".
          if (distToBg(r, g, b) < 55) {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
          } else {
            const key = `${Math.round(r/10)*10},${Math.round(g/10)*10},${Math.round(b/10)*10}`;
            colorCounts[key] = (colorCounts[key] || 0) + 1;
          }
        } else {
          // 2. Collect colors for quantization (Color Filling Logic)
          // We round colors to reduce noise for histogram
          const key = `${Math.round(r/10)*10},${Math.round(g/10)*10},${Math.round(b/10)*10}`;
          colorCounts[key] = (colorCounts[key] || 0) + 1;
        }
      }

      // Identify dominant colors (excluding black/white)
      const dominantColors = Object.entries(colorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8) // Keep top 8 colors
        .map(([key]) => key.split(',').map(Number));

      // 3. Anti-Aliasing Suppression: Map non-black/white pixels to nearest dominant color
      if (dominantColors.length > 0) {
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          const isBlack = r === 0 && g === 0 && b === 0;
          const isWhite = r === 255 && g === 255 && b === 255;
          
          if (!isBlack && !isWhite) {
            let minDist = Infinity;
            let bestColor = [r, g, b];
            
            for (const dc of dominantColors) {
              const dist = Math.sqrt((r-dc[0])**2 + (g-dc[1])**2 + (b-dc[2])**2);
              if (dist < minDist) {
                minDist = dist;
                bestColor = dc;
              }
            }
            
            // If the nearest dominant color is close enough, snap to it
            // This suppresses "muddy" anti-aliasing colors
            // Stricter snapping reduces edge "muddy" colors.
            if (minDist < 70) {
              data[i] = bestColor[0];
              data[i + 1] = bestColor[1];
              data[i + 2] = bestColor[2];
            }
          }
        }
      }
      // ----------------------------------------------------------

      // 2. Floyd-Steinberg Dithering
      // We work on a copy of the data to avoid modifying the original during the pass
      const pixels: PixelData[][] = [];
      const errorBuffer = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) errorBuffer[i] = data[i];

      for (let y = 0; y < targetHeight; y++) {
        const row: PixelData[] = [];
        for (let x = 0; x < targetWidth; x++) {
          const idx = (y * targetWidth + x) * 4;
          
          let r = errorBuffer[idx];
          let g = errorBuffer[idx + 1];
          let b = errorBuffer[idx + 2];

          // Clamp values
          r = Math.max(0, Math.min(255, r));
          g = Math.max(0, Math.min(255, g));
          b = Math.max(0, Math.min(255, b));

          const nearest = findNearestBeadColor(r, g, b, palette);
          row.push({ color: nearest, x, y });

          if (useDithering) {
            const errR = r - nearest.r;
            const errG = g - nearest.g;
            const errB = b - nearest.b;

            // Distribute error to neighbors
            const distribute = (nx: number, ny: number, weight: number) => {
              if (nx >= 0 && nx < targetWidth && ny >= 0 && ny < targetHeight) {
                const nIdx = (ny * targetWidth + nx) * 4;
                errorBuffer[nIdx] += errR * weight;
                errorBuffer[nIdx + 1] += errG * weight;
                errorBuffer[nIdx + 2] += errB * weight;
              }
            };

            distribute(x + 1, y, 7 / 16);
            distribute(x - 1, y + 1, 3 / 16);
            distribute(x, y + 1, 5 / 16);
            distribute(x + 1, y + 1, 1 / 16);
          }
        }
        pixels.push(row);
      }

      resolve(pixels);
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

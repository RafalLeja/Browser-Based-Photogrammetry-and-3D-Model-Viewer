// Checks photos in the browser before they are uploaded: blur, exposure, near-duplicates and low
// resolution. COLMAP cannot match blurry or burnt-out photos, so catching them here saves a run.
// Pure functions on greyscale pixels, so Node can test them; the browser part is checkPhoto().

export type PhotoIssue = 'blurry' | 'dark' | 'bright' | 'duplicate' | 'small';

export interface PhotoMeasure {
  /** Variance of the Laplacian: high for sharp edges, low for blur. */
  sharpness: number;
  /** Mean brightness, 0 to 255. */
  brightness: number;
  /** Share of pixels that are nearly black or nearly white. */
  dark: number;
  bright: number;
  /** 64-bit difference hash: similar photos have similar hashes. */
  hash: bigint;
  /** Original size in megapixels. */
  megapixels: number;
}

export const ISSUE_LABELS: Record<PhotoIssue, string> = {
  blurry: 'Blurry',
  dark: 'Too dark',
  bright: 'Burnt out',
  duplicate: 'Duplicate',
  small: 'Low resolution',
};

/** Rec. 601 luma of RGBA pixels. */
export function grayscale(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return gray;
}

/** Variance of the 4-neighbour Laplacian, the classic cheap focus measure. */
export function laplacianVariance(gray: Float32Array, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += value;
      sumSq += value * value;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export function exposure(gray: Float32Array): { brightness: number; dark: number; bright: number } {
  let sum = 0;
  let dark = 0;
  let bright = 0;
  for (const value of gray) {
    sum += value;
    if (value < 16) dark++;
    else if (value > 245) bright++;
  }
  const n = gray.length || 1;
  return { brightness: sum / n, dark: dark / n, bright: bright / n };
}

/** Difference hash: the image shrunk to 9 × 8, one bit per pair of horizontal neighbours. */
export function differenceHash(gray: Float32Array, width: number, height: number): bigint {
  const cell = (cx: number, cy: number) => {
    const x0 = Math.floor((cx * width) / 9);
    const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / 9));
    const y0 = Math.floor((cy * height) / 8);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / 8));
    let sum = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += gray[y * width + x];
    return sum / ((x1 - x0) * (y1 - y0));
  };
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    const row = Array.from({ length: 9 }, (_, x) => cell(x, y));
    for (let x = 0; x < 8; x++) hash = (hash << 1n) | (row[x] > row[x + 1] ? 1n : 0n);
  }
  return hash;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let value = a ^ b;
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The problems of each photo in a set. Blur is judged against the rest of the set, because a
 * set shares one subject and one camera: a photo far less sharp than the set's median is blurry
 * even when its absolute score would pass elsewhere.
 */
export function assessPhotos(measures: PhotoMeasure[]): PhotoIssue[][] {
  const sharpMedian = measures.length >= 3 ? median(measures.map((m) => m.sharpness)) : 0;
  return measures.map((m, index) => {
    const issues: PhotoIssue[] = [];
    if (m.sharpness < 12 || (sharpMedian > 0 && m.sharpness < sharpMedian * 0.35)) issues.push('blurry');
    if (m.brightness < 45 || m.dark > 0.5) issues.push('dark');
    else if (m.bright > 0.25) issues.push('bright');
    if (measures.slice(0, index).some((earlier) => hammingDistance(earlier.hash, m.hash) <= 2)) issues.push('duplicate');
    if (m.megapixels > 0 && m.megapixels < 2) issues.push('small');
    return issues;
  });
}

const SAMPLE_WIDTH = 512;

/** Decodes one photo off the main thread and measures a 512-pixel-wide copy of it. */
export async function checkPhoto(file: Blob): Promise<PhotoMeasure> {
  const bitmap = await createImageBitmap(file);
  const width = Math.min(SAMPLE_WIDTH, bitmap.width);
  const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D canvas is not available');
  context.drawImage(bitmap, 0, 0, width, height);
  const megapixels = (bitmap.width * bitmap.height) / 1e6;
  bitmap.close();
  const gray = grayscale(context.getImageData(0, 0, width, height).data, width, height);
  return { sharpness: laplacianVariance(gray, width, height), ...exposure(gray), hash: differenceHash(gray, width, height), megapixels };
}

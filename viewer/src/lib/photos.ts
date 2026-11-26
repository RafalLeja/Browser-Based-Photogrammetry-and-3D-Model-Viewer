// Checks a photo selection in the browser before upload, mirroring the server rules so people
// learn about a problem in a second instead of after a long upload. The server checks again.

export interface PhotoLimits {
  min_photos: number;
  max_photos: number;
  max_photo_mb: number;
  max_upload_mb: number;
}

export const DEFAULT_LIMITS: PhotoLimits = { min_photos: 3, max_photos: 500, max_photo_mb: 40, max_upload_mb: 4096 };

/** The parts of a File this module needs, so Node tests can pass plain objects. */
export interface FileLike {
  name: string;
  size: number;
  type: string;
}

export interface Selection<T extends FileLike> {
  accepted: T[];
  rejected: { file: T; reason: string }[];
  photoCount: number;
  zipCount: number;
  totalBytes: number;
}

const PHOTO = /\.(jpe?g|png)$/i;
const ZIP = /\.zip$/i;
const UNSUPPORTED_HINT = /\.(heic|heif|webp|tiff?|raw|cr2|nef|arw|dng)$/i;

export function isZip(file: FileLike): boolean {
  return ZIP.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

export function isPhoto(file: FileLike): boolean {
  return PHOTO.test(file.name) || file.type === 'image/jpeg' || file.type === 'image/png';
}

/** Adds `incoming` to `current`, skipping duplicates (same name and size) and explaining every rejection. */
export function selectPhotos<T extends FileLike>(current: T[], incoming: T[], limits: PhotoLimits = DEFAULT_LIMITS): Selection<T> {
  const accepted = [...current];
  const rejected: Selection<T>['rejected'] = [];
  const seen = new Set(current.map((f) => `${f.name}:${f.size}`));
  const maxBytes = limits.max_photo_mb * 1024 * 1024;

  for (const file of incoming) {
    const key = `${file.name}:${file.size}`;
    if (seen.has(key)) continue;
    if (file.name.startsWith('.')) continue; // .DS_Store and friends from folder picks
    if (!isPhoto(file) && !isZip(file)) {
      const reason = UNSUPPORTED_HINT.test(file.name)
        ? 'Convert to JPEG or PNG first; the pipeline cannot read this format.'
        : 'Not a JPEG, PNG or zip file.';
      rejected.push({ file, reason });
      continue;
    }
    if (isPhoto(file) && file.size > maxBytes) {
      rejected.push({ file, reason: `Larger than ${limits.max_photo_mb} MB.` });
      continue;
    }
    if (file.size === 0) {
      rejected.push({ file, reason: 'The file is empty.' });
      continue;
    }
    seen.add(key);
    accepted.push(file);
  }

  const photoCount = accepted.filter((f) => !isZip(f)).length;
  return {
    accepted,
    rejected,
    photoCount,
    zipCount: accepted.length - photoCount,
    totalBytes: accepted.reduce((sum, f) => sum + f.size, 0),
  };
}

export type ReadyState = { ok: true } | { ok: false; reason: string };

/** Whether the selection may be uploaded. Zips are counted on the server, so they always pass here. */
export function readyToUpload(selection: Selection<FileLike>, limits: PhotoLimits = DEFAULT_LIMITS): ReadyState {
  const { photoCount, zipCount, totalBytes } = selection;
  if (photoCount + zipCount === 0) return { ok: false, reason: 'Add photos to start.' };
  if (zipCount === 0 && photoCount < limits.min_photos) {
    return { ok: false, reason: `Add at least ${limits.min_photos} photos.` };
  }
  if (photoCount > limits.max_photos) return { ok: false, reason: `Use at most ${limits.max_photos} photos.` };
  if (totalBytes > limits.max_upload_mb * 1024 * 1024) {
    return { ok: false, reason: `The upload is larger than ${limits.max_upload_mb} MB.` };
  }
  return { ok: true };
}

/** 0 = not enough, 1 = workable, 2 = good, 3 = great. Photogrammetry wants overlap, so more photos help. */
export function coverageLevel(photoCount: number): 0 | 1 | 2 | 3 {
  if (photoCount < 3) return 0;
  if (photoCount < 20) return 1;
  if (photoCount < 50) return 2;
  return 3;
}

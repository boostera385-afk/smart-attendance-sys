/**
 * Client-side photo checks for face enrollment (browser only, no dependencies).
 * These are a fast first filter so people fix lighting / blur / framing before uploading;
 * the recognition worker still does the authoritative face detection and sharpness check.
 */

export type Issue = { code: string; message: string; blocking: boolean };

export type Quality = {
  brightness: number; // mean luma of the face region, 0–255
  contrast: number; // std-dev of luma
  sharpness: number; // variance of the Laplacian (higher = sharper)
  motion: number; // mean abs difference vs previous frame (live only)
  faces: number | null; // null = browser can't detect faces
  issues: Issue[];
};

export type Region = { x: number; y: number; w: number; h: number };

/**
 * Face guide for a frame of the given size, as fractions of the frame: an oval 76% of the frame
 * high with a natural face aspect (≈0.78 w/h), whatever the camera's aspect ratio.
 */
export function guideFor(width: number, height: number): Region {
  const h = 0.76;
  const w = Math.min(0.9, (h * 0.78 * height) / width);
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

const SIZE = 160;
const T = { dark: 60, bright: 210, flat: 18, blur: 28, motion: 12, backlight: 0.65 };

type DetectedFace = { boundingBox: DOMRectReadOnly };
type FaceDetectorCtor = new (o?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
  detect(src: ImageBitmapSource): Promise<DetectedFace[]>;
};

let detector: InstanceType<FaceDetectorCtor> | null | undefined;
/** Chrome's Shape Detection API where available (Android, ChromeOS, macOS); null elsewhere. */
function getDetector() {
  if (detector !== undefined) return detector;
  const Ctor = (globalThis as unknown as { FaceDetector?: FaceDetectorCtor }).FaceDetector;
  try {
    detector = Ctor ? new Ctor({ fastMode: true, maxDetectedFaces: 3 }) : null;
  } catch {
    detector = null;
  }
  return detector;
}

let scratch: CanvasRenderingContext2D | null = null;
function ctx(w: number, h: number) {
  if (!scratch) scratch = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const c = scratch!;
  if (c.canvas.width !== w || c.canvas.height !== h) {
    c.canvas.width = w;
    c.canvas.height = h;
  }
  return c;
}

function luma(d: Uint8ClampedArray) {
  const g = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  return g;
}

function stats(g: Uint8ClampedArray, w: number, h: number) {
  let sum = 0;
  for (const v of g) sum += v;
  const mean = sum / g.length;
  let varSum = 0;
  for (const v of g) varSum += (v - mean) ** 2;
  // Laplacian variance: classic focus measure
  let lSum = 0, lSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i];
      lSum += l;
      lSq += l * l;
      n++;
    }
  }
  return { mean, std: Math.sqrt(varSum / g.length), lap: lSq / n - (lSum / n) ** 2 };
}

export type Frame = { gray: Uint8ClampedArray };

/**
 * Analyses one frame. `region` is the part that should contain the face (fractions of the
 * source); pass `prev` from the last call to measure motion.
 */
export async function analyze(
  src: HTMLVideoElement | ImageBitmap,
  opts: { region?: Region; prev?: Frame | null; detectFace?: boolean } = {},
): Promise<{ quality: Quality; frame: Frame }> {
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
  const r = opts.region ?? { x: 0, y: 0, w: 1, h: 1 };
  const rw = Math.round(SIZE * Math.min(1, (r.w * sw) / (r.h * sh)));
  const rh = Math.round(SIZE * Math.min(1, (r.h * sh) / (r.w * sw)));

  const c = ctx(rw, rh);
  c.drawImage(src, r.x * sw, r.y * sh, r.w * sw, r.h * sh, 0, 0, rw, rh);
  const gray = luma(c.getImageData(0, 0, rw, rh).data);
  const s = stats(gray, rw, rh);

  let motion = 0;
  if (opts.prev && opts.prev.gray.length === gray.length) {
    let d = 0;
    for (let i = 0; i < gray.length; i++) d += Math.abs(gray[i] - opts.prev.gray[i]);
    motion = d / gray.length;
  }

  // whole-frame brightness, for backlight detection
  let frameMean = s.mean;
  if (opts.region) {
    const f = ctx(32, 24);
    f.drawImage(src, 0, 0, 32, 24);
    const fg = luma(f.getImageData(0, 0, 32, 24).data);
    frameMean = fg.reduce((a, b) => a + b, 0) / fg.length;
  }

  const issues: Issue[] = [];
  if (s.mean < T.dark) issues.push({ code: "dark", message: "Too dark: face a window or turn on a light", blocking: true });
  else if (s.mean > T.bright) issues.push({ code: "bright", message: "Too bright: move away from direct light", blocking: true });
  else if (opts.region && frameMean > 110 && s.mean < frameMean * T.backlight)
    issues.push({ code: "backlight", message: "Light is behind you: turn to face the light", blocking: true });
  else if (s.std < T.flat) issues.push({ code: "flat", message: "Image is washed out: improve the lighting", blocking: false });
  if (motion > T.motion) issues.push({ code: "motion", message: "Hold still", blocking: true });
  else if (s.lap < T.blur) issues.push({ code: "blur", message: "Image is blurry: hold steady or clean the lens", blocking: true });

  let faces: number | null = null;
  const det = opts.detectFace === false ? null : getDetector();
  if (det) {
    try {
      const found = await det.detect(src);
      faces = found.length;
      if (!found.length) issues.unshift({ code: "noface", message: "No face found: look at the camera", blocking: true });
      else if (found.length > 1) issues.unshift({ code: "many", message: "Only one person in the photo", blocking: true });
      else {
        const b = found[0].boundingBox;
        const fw = b.width / sw;
        const cx = (b.x + b.width / 2) / sw;
        const cy = (b.y + b.height / 2) / sh;
        if (fw < 0.2) issues.unshift({ code: "far", message: "Move closer", blocking: true });
        else if (fw > 0.7) issues.unshift({ code: "near", message: "Move back a little", blocking: true });
        else if (opts.region && (Math.abs(cx - 0.5) > 0.15 || Math.abs(cy - 0.5) > 0.18))
          issues.unshift({ code: "center", message: "Center your face in the oval", blocking: true });
      }
    } catch {
      detector = null; // unsupported on this platform after all
    }
  }

  return {
    quality: { brightness: s.mean, contrast: s.std, sharpness: s.lap, motion, faces, issues },
    frame: { gray },
  };
}

export type FileCheck = { ok: true; bitmap: ImageBitmap; warnings: string[] } | { ok: false; reason: string };

const MIN_SIDE = 400;
const MAX_INPUT = 25 * 1024 * 1024;

/** Validates a picked file before upload: type, size, resolution, lighting and blur. */
export async function checkFile(f: File): Promise<FileCheck> {
  if (/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name))
    return { ok: false, reason: "HEIC photos aren't supported. Share it as JPG, or set the camera to 'Most compatible'." };
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return { ok: false, reason: "Use a JPG, PNG or WebP photo." };
  if (f.size > MAX_INPUT) return { ok: false, reason: "File is larger than 25 MB." };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(f, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, reason: "This file can't be read as an image." };
  }
  if (Math.min(bitmap.width, bitmap.height) < MIN_SIDE) {
    bitmap.close();
    return { ok: false, reason: `Resolution too low (${bitmap.width}×${bitmap.height}). Use at least ${MIN_SIDE}px.` };
  }
  const { quality } = await analyze(bitmap);
  const blocking = quality.issues.filter((i) => i.blocking && i.code !== "far");
  if (blocking.length) {
    bitmap.close();
    return { ok: false, reason: blocking[0].message.replace(/:.*/, "") + "." };
  }
  return { ok: true, bitmap, warnings: quality.issues.map((i) => i.message) };
}

/** Downscales to ≤1280 px JPEG (~150–300 KB) so uploads stay fast and under server limits. */
export async function toJpeg(src: Blob | ImageBitmap): Promise<File> {
  const bmp = src instanceof Blob ? await createImageBitmap(src, { imageOrientation: "from-image" }) : src;
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const c = canvas.getContext("2d")!;
  c.imageSmoothingQuality = "high";
  c.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode photo"))), "image/jpeg", 0.9),
  );
  return new File([blob], "face.jpg", { type: "image/jpeg" });
}

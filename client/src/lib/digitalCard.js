// The patient's digital copy of their physical MediCard: the card UID read over NFC plus a
// flat 2D image of the card's front made from a photo. Kept on this device only (the photo
// never leaves the phone), one copy per signed-in patient.
const KEY_PREFIX = "medicard-digital-card:";

// Physical ID cards (ISO/IEC 7810 ID-1) are 53.98 x 85.60 mm. MediCards are printed in
// portrait, so the ratio is width / height.
export const CARD_RATIO = 53.98 / 85.6;
export const CARD_WIDTH = 638;
export const CARD_HEIGHT = Math.round(CARD_WIDTH / CARD_RATIO); // 1012

// Bumped when the stored image format changes; older copies are ignored.
export const CARD_FORMAT = 2;

export function loadDigitalCard(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + userId);
    const card = raw ? JSON.parse(raw) : null;
    return card?.format === CARD_FORMAT ? card : null;
  } catch {
    return null;
  }
}

// Returns false when the browser refuses to store it (private mode, storage full).
export function saveDigitalCard(userId, card) {
  try {
    localStorage.setItem(KEY_PREFIX + userId, JSON.stringify({ ...card, format: CARD_FORMAT }));
    return true;
  } catch {
    return false;
  }
}

export function removeDigitalCard(userId) {
  try {
    localStorage.removeItem(KEY_PREFIX + userId);
  } catch {
    // nothing stored, or storage unavailable
  }
}

export function normalizeUid(uid) {
  return String(uid || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
}

// Copies a video frame or image into a canvas at its full resolution, so the corners can be
// adjusted and the card flattened from the original pixels.
export function snapshot(source) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(source, 0, 0, width, height);
  return canvas;
}

// Corners (top-left, top-right, bottom-right, bottom-left) of the largest portrait card shape
// that fits centred in a width x height picture, inset a little. Starting guess for photos
// picked from the gallery.
export function defaultCorners(width, height) {
  let h = height * 0.86;
  let w = h * CARD_RATIO;
  if (w > width * 0.86) {
    w = width * 0.86;
    h = w / CARD_RATIO;
  }
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

// Solves the 3x3 perspective transform that maps each `from` point onto its `to` point.
function homography(from, to) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = from[i];
    const { x, y } = to[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let r = col + 1; r < 8; r++) {
      const f = A[r][col] / A[col][col];
      for (let c = col; c < 8; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const h = new Array(8);
  for (let r = 7; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < 8; c++) s -= A[r][c] * h[c];
    h[r] = s / A[r][r];
  }
  return [...h, 1];
}

// Turns the four marked corners of the card in `sourceCanvas` into a flat, straight, upright
// portrait card image: the perspective is undone, the card is cropped out of its background,
// and the colours are evened out so it reads like the printed design rather than a photo.
export function flattenCard(sourceCanvas, corners) {
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  const src = sourceCanvas.getContext("2d").getImageData(0, 0, srcW, srcH).data;

  const out = document.createElement("canvas");
  out.width = CARD_WIDTH;
  out.height = CARD_HEIGHT;
  const ctx = out.getContext("2d");
  const image = ctx.createImageData(CARD_WIDTH, CARD_HEIGHT);
  const dst = image.data;

  const destCorners = [
    { x: 0, y: 0 },
    { x: CARD_WIDTH - 1, y: 0 },
    { x: CARD_WIDTH - 1, y: CARD_HEIGHT - 1 },
    { x: 0, y: CARD_HEIGHT - 1 },
  ];
  const [a, bb, c, d, e, f, g, h] = homography(destCorners, corners);

  for (let y = 0; y < CARD_HEIGHT; y++) {
    for (let x = 0; x < CARD_WIDTH; x++) {
      const w = g * x + h * y + 1;
      const sx = (a * x + bb * y + c) / w;
      const sy = (d * x + e * y + f) / w;
      const o = (y * CARD_WIDTH + x) * 4;
      // Bilinear sampling, clamped to the photo's edges.
      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(sy)));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const fy = Math.max(0, Math.min(1, sy - y0));
      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;
      for (let k = 0; k < 3; k++) {
        const top = src[i00 + k] * (1 - fx) + src[i10 + k] * fx;
        const bottom = src[i01 + k] * (1 - fx) + src[i11 + k] * fx;
        dst[o + k] = top * (1 - fy) + bottom * fy;
      }
      dst[o + 3] = 255;
    }
  }

  autoLevels(dst);
  ctx.putImageData(image, 0, 0);
  return out.toDataURL("image/jpeg", 0.9);
}

// Stretches each colour channel so its darkest 1% becomes black and brightest 1% white:
// removes the grey/yellow cast of indoor light and the flat look of a phone photo.
function autoLevels(px) {
  const count = px.length / 4;
  const lo = [];
  const hi = [];
  for (let k = 0; k < 3; k++) {
    const hist = new Uint32Array(256);
    for (let i = k; i < px.length; i += 4) hist[px[i] | 0]++;
    let acc = 0;
    let low = 0;
    while (low < 255 && (acc += hist[low]) < count * 0.01) low++;
    acc = 0;
    let high = 255;
    while (high > 0 && (acc += hist[high]) < count * 0.01) high--;
    lo.push(low);
    hi.push(high);
  }
  for (let k = 0; k < 3; k++) {
    const range = hi[k] - lo[k];
    // Leave a channel alone when it's nearly flat (e.g. a mostly single-colour card).
    if (range < 40) continue;
    const scale = 255 / range;
    for (let i = k; i < px.length; i += 4) {
      px[i] = Math.max(0, Math.min(255, (px[i] - lo[k]) * scale));
    }
  }
}

// The patient's digital copy of their physical MediCard: the card UID read over NFC plus a
// photo of the card's front. Kept on this device only (the photo never leaves the phone), one
// copy per signed-in patient.
const KEY_PREFIX = "medicard-digital-card:";

// Physical ID cards (ISO/IEC 7810 ID-1) are 85.60 x 53.98 mm.
export const CARD_RATIO = 85.6 / 53.98;

export function loadDigitalCard(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + userId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Returns false when the browser refuses to store it (private mode, storage full).
export function saveDigitalCard(userId, card) {
  try {
    localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(card));
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

// Draws the part of `source` (video frame or image) inside the source-space rectangle onto a
// card-shaped canvas and returns it as a JPEG data URL.
export function cropToCard(source, sx, sy, sw, sh, width = 1012) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(width / CARD_RATIO);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Centre-crops a whole image to the card's shape (used for photos picked from the gallery).
export function centerCropToCard(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  let sw = w;
  let sh = w / CARD_RATIO;
  if (sh > h) {
    sh = h;
    sw = h * CARD_RATIO;
  }
  return cropToCard(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
}

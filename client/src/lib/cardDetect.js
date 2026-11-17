// Finds the MediCard in a camera frame or photo and judges whether the shot is good enough to
// turn into a flat 2D card. Uses OpenCV.js (about 10 MB), which is loaded only when the card
// copy camera opens.
import { CARD_RATIO } from "./digitalCard.js";

let cvPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Couldn't load the card scanner."));
    document.head.appendChild(script);
  });
}

// Resolves with { cv }. OpenCV.js is loaded as a plain script (not an ES import) and handed
// back inside a wrapper object, because the emscripten module has its own `then` method: a
// promise resolved with it directly keeps "adopting" it forever and freezes the page.
export function loadOpenCv() {
  if (!cvPromise) {
    cvPromise = import("@techstark/opencv-js/dist/opencv.js?url")
      .then(({ default: url }) => loadScript(url))
      .then(
        () =>
          new Promise((resolve, reject) => {
            let cv = window.cv;
            if (!cv) return reject(new Error("Couldn't load the card scanner."));
            if (typeof cv === "function" && !cv.Mat) cv = cv();
            if (cv.Mat) return resolve({ cv });
            cv.onRuntimeInitialized = () => resolve({ cv });
          })
      );
    cvPromise.catch(() => {
      cvPromise = null;
    });
  }
  return cvPromise;
}

const WORK_SIZE = 480; // longest side of the downscaled frame the detector looks at

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Orders four points as top-left, top-right, bottom-right, bottom-left, then rotates the order
// if needed so the card comes out in portrait (its short edges at top and bottom).
function orderCorners(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // atan2 order starts near the left (-PI); find the top-left as the point with the smallest x + y.
  let start = 0;
  sorted.forEach((p, i) => {
    if (p.x + p.y < sorted[start].x + sorted[start].y) start = i;
  });
  let ordered = [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
  const top = dist(ordered[0], ordered[1]) + dist(ordered[3], ordered[2]);
  const side = dist(ordered[0], ordered[3]) + dist(ordered[1], ordered[2]);
  if (top > side) ordered = [ordered[3], ordered[0], ordered[1], ordered[2]];
  return ordered;
}

function polygonArea(p) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return Math.abs(a) / 2;
}

// Looks for the card in `source` (a video, image or canvas). Returns the card's corners in
// the source's own pixels (or null when no card-shaped outline is found) plus a few measures
// used for the on-screen tips.
export function detectCard(cv, source, { viewAspect = null } = {}) {
  const srcW = source.videoWidth || source.naturalWidth || source.width;
  const srcH = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, WORK_SIZE / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);

  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let best = null;
  let brightness = 0;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    brightness = cv.mean(gray)[0];
    // Find edges in each colour channel separately and combine them: a coloured card band
    // (e.g. a blue header on a brown desk) can have almost the same grey level as the
    // background, but differs clearly in at least one channel.
    const blurred = new cv.Mat();
    cv.GaussianBlur(src, blurred, new cv.Size(5, 5), 0);
    const channels = new cv.MatVector();
    cv.split(blurred, channels);
    const channelEdges = new cv.Mat();
    for (let c = 0; c < 3; c++) {
      const ch = channels.get(c);
      cv.Canny(ch, channelEdges, 30, 90);
      if (c === 0) channelEdges.copyTo(edges);
      else cv.bitwise_or(edges, channelEdges, edges);
      ch.delete();
    }
    channelEdges.delete();
    channels.delete();
    blurred.delete();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, edges, kernel);
    kernel.delete();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const frameArea = w * h;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area < frameArea * 0.08) {
        contour.delete();
        continue;
      }
      const hull = new cv.Mat();
      cv.convexHull(contour, hull);
      const approx = new cv.Mat();
      cv.approxPolyDP(hull, approx, 0.03 * cv.arcLength(hull, true), true);
      if (approx.rows === 4) {
        const pts = [];
        for (let k = 0; k < 4; k++) pts.push({ x: approx.data32S[k * 2], y: approx.data32S[k * 2 + 1] });
        const quadArea = polygonArea(pts);
        if (!best || quadArea > best.area) best = { pts, area: quadArea };
      }
      hull.delete();
      approx.delete();
      contour.delete();
    }
  } finally {
    src.delete();
    gray.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }

  const result = { width: srcW, height: srcH, brightness, corners: null };
  if (!best) return result;

  const ordered = orderCorners(best.pts);
  // Pull the corners in very slightly so no strip of the desk shows along the card's edges.
  const mx = ordered.reduce((s, p) => s + p.x, 0) / 4;
  const my = ordered.reduce((s, p) => s + p.y, 0) / 4;
  result.corners = ordered.map((p) => ({
    x: (p.x + (mx - p.x) * 0.015) / scale,
    y: (p.y + (my - p.y) * 0.015) / scale,
  }));

  // The part of the frame the person actually sees (the preview box crops the video to
  // `viewAspect`), so "closer" / "back a little" match what's on screen.
  let vx = 0, vy = 0, vw = w, vh = h;
  if (viewAspect && w / h > viewAspect) {
    vw = h * viewAspect;
    vx = (w - vw) / 2;
  } else if (viewAspect) {
    vh = w / viewAspect;
    vy = (h - vh) / 2;
  }
  result.areaFraction = best.area / (vw * vh);

  // Shape checks: how far the outline is from a straight-on card.
  const [tl, tr, br, bl] = ordered;
  const topLen = dist(tl, tr);
  const bottomLen = dist(bl, br);
  const leftLen = dist(tl, bl);
  const rightLen = dist(tr, br);
  result.skew = Math.min(topLen / bottomLen, bottomLen / topLen, leftLen / rightLen, rightLen / leftLen);
  result.ratio = (topLen + bottomLen) / (leftLen + rightLen);
  result.angle = Math.abs((Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI);
  const margin = Math.min(vw, vh) * 0.015;
  result.touchesEdge = ordered.some(
    (p) => p.x < vx + margin || p.y < vy + margin || p.x > vx + vw - margin || p.y > vy + vh - margin
  );

  // Glare: share of blown-out pixels inside the card's bounding box.
  const xs = ordered.map((p) => p.x);
  const ys = ordered.map((p) => p.y);
  const bx = Math.max(0, Math.floor(Math.min(...xs)));
  const by = Math.max(0, Math.floor(Math.min(...ys)));
  const bw = Math.max(1, Math.min(w, Math.ceil(Math.max(...xs))) - bx);
  const bh = Math.max(1, Math.min(h, Math.ceil(Math.max(...ys))) - by);
  const px = ctx.getImageData(bx, by, bw, bh).data;
  let blown = 0;
  for (let i = 0; i < px.length; i += 16) {
    if (px[i] > 248 && px[i + 1] > 248 && px[i + 2] > 248) blown++;
  }
  result.glare = blown / (px.length / 16);
  return result;
}

// Turns a detection into one short tip for the person holding the phone. `ok` means the shot
// is good enough to capture.
export function adviseShot(d) {
  if (!d) return { ok: false, tip: "Getting the camera ready…" };
  if (d.brightness < 55) return { ok: false, tip: "Too dark. Move somewhere with more light." };
  if (!d.corners) return { ok: false, tip: "Place your card inside the frame, on a plain darker surface." };
  if (d.touchesEdge || d.areaFraction > 0.85) return { ok: false, tip: "Move your phone back a little." };
  if (d.areaFraction < 0.22) return { ok: false, tip: "Move your phone closer to the card." };
  if (d.angle > 12 && d.angle < 168) return { ok: false, tip: "Turn the card so it stands upright." };
  // Some tilt is fine (the photo is straightened afterwards); only a steep angle loses detail.
  if (d.skew < 0.75) return { ok: false, tip: "Hold your phone flat, straight above the card." };
  if (Math.abs(d.ratio - CARD_RATIO) > 0.18) return { ok: false, tip: "Hold your phone flat, straight above the card." };
  if (d.glare > 0.08) return { ok: false, tip: "There's glare on the card. Tilt it slightly away from the light." };
  return { ok: true, tip: "Hold steady…" };
}

// True when two detections' corners are within `tolerance` (fraction of the frame) of each
// other, i.e. the phone is being held still.
export function isSteady(a, b, tolerance = 0.012) {
  if (!a?.corners || !b?.corners) return false;
  const limit = Math.max(a.width, a.height) * tolerance;
  return a.corners.every((p, i) => dist(p, b.corners[i]) < limit);
}

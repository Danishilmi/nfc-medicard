import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ImageUp, Nfc, RotateCcw, ShieldCheck, Sparkles, X } from "lucide-react";
import { isNfcSupported, scanOnce } from "../lib/nfc.js";
import { CARD_RATIO, defaultCorners, flattenCard, normalizeUid, snapshot } from "../lib/digitalCard.js";
import { t } from "../i18n/index.js";

// Full-screen flow that copies the patient's physical MediCard onto the phone:
//   1. read the card's UID over NFC and check it is this patient's registered card,
//   2. open the camera and photograph the front of the (portrait) card,
//   3. fine-tune the card's four corners; the photo is then flattened into a straight 2D card,
//   4. review the 2D card and save it as the digital card.
export default function CopyCardWizard({ registeredUid, onSave, onClose }) {
  const [step, setStep] = useState("nfc");
  const [uid, setUid] = useState(null);
  const [verified, setVerified] = useState(false);
  const [photo, setPhoto] = useState(null); // { canvas, corners }
  const [image, setImage] = useState(null);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-semibold">{t("Copy my card")}</p>
        <StepDots step={step} />
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-slate-300 hover:bg-white/10"
          aria-label={t("Close")}
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-6">
        {step === "nfc" && (
          <NfcStep
            registeredUid={registeredUid}
            onDone={(readUid, isVerified) => {
              setUid(readUid);
              setVerified(isVerified);
              setStep("camera");
            }}
          />
        )}
        {step === "camera" && (
          <CameraStep
            onCapture={(canvas, corners) => {
              setPhoto({ canvas, corners });
              setStep("adjust");
            }}
          />
        )}
        {step === "adjust" && photo && (
          <AdjustStep
            photo={photo}
            onRetake={() => setStep("camera")}
            onDone={(dataUrl) => {
              setImage(dataUrl);
              setStep("review");
            }}
          />
        )}
        {step === "review" && (
          <ReviewStep
            image={image}
            uid={uid}
            verified={verified}
            onAdjust={() => setStep("adjust")}
            onSave={() => onSave({ uid, verified, image, copiedAt: new Date().toISOString() })}
          />
        )}
      </div>
    </div>
  );
}

function StepDots({ step }) {
  const steps = ["nfc", "camera", "adjust", "review"];
  const at = steps.indexOf(step);
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {steps.map((s, i) => (
        <span key={s} className={`h-1.5 w-6 rounded-full ${i <= at ? "bg-sky-400" : "bg-white/20"}`} />
      ))}
    </div>
  );
}

function NfcStep({ registeredUid, onDone }) {
  const supported = isNfcSupported();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const startScan = async () => {
    setError(null);
    setScanning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const readUid = await scanOnce({ signal: controller.signal });
      if (normalizeUid(readUid) !== normalizeUid(registeredUid)) {
        setError(t("This card isn't the one registered to your account. Tap your own MediCard."));
        return;
      }
      onDone(normalizeUid(readUid), true);
    } catch (err) {
      if (!controller.signal.aborted) setError(err?.message || t("Failed to read the NFC card. Try tapping it again."));
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
      <div className={`flex h-28 w-28 items-center justify-center rounded-full bg-sky-500/15 ${scanning ? "animate-pulse" : ""}`}>
        <Nfc size={56} className="text-sky-400" />
      </div>
      <div>
        <h2 className="text-lg font-bold">{t("Step 1: Tap your card")}</h2>
        <p className="mt-1 text-sm text-slate-300">
          {supported
            ? t("Turn on NFC, then hold your physical MediCard against the back of your phone.")
            : t("This browser can't read NFC cards. Use Chrome on an Android phone with NFC turned on, or continue with your registered card number.")}
        </p>
      </div>

      {error && <p className="w-full rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</p>}

      {supported && (
        <button
          type="button"
          onClick={startScan}
          disabled={scanning}
          className="w-full rounded-xl bg-sky-500 px-4 py-3 font-semibold text-white hover:bg-sky-400 disabled:opacity-70"
        >
          {scanning ? t("Waiting for your card…") : t("Start NFC scan")}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          abortRef.current?.abort();
          onDone(normalizeUid(registeredUid), false);
        }}
        className="text-sm font-medium text-slate-300 underline-offset-2 hover:underline"
      >
        {t("Continue without NFC")}
      </button>
    </div>
  );
}

function CameraStep({ onCapture }) {
  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const fileRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState("starting"); // starting | live | failed
  const [error, setError] = useState(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("failed");
        setError(t("The camera needs a secure (https) page. You can pick a photo of your card instead."));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus("live");
      } catch (err) {
        if (cancelled) return;
        setStatus("failed");
        setError(
          err?.name === "NotAllowedError"
            ? t("Camera permission was denied. Allow it in your browser settings, or pick a photo of your card instead.")
            : t("Couldn't open the camera. You can pick a photo of your card instead.")
        );
      }
    }
    start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [stopStream]);

  // Keeps the whole video frame, and maps the on-screen card guide back to the video's own
  // pixels (the video is drawn with object-cover, so it is scaled and centred in its box) as
  // the starting corners for the adjust step.
  const capture = () => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame || !video.videoWidth) return;
    const box = video.getBoundingClientRect();
    const rect = frame.getBoundingClientRect();
    const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
    const offsetX = (box.width - video.videoWidth * scale) / 2;
    const offsetY = (box.height - video.videoHeight * scale) / 2;
    const toSource = (px, py) => ({
      x: (px - box.left - offsetX) / scale,
      y: (py - box.top - offsetY) / scale,
    });
    const corners = [
      toSource(rect.left, rect.top),
      toSource(rect.right, rect.top),
      toSource(rect.right, rect.bottom),
      toSource(rect.left, rect.bottom),
    ];
    const canvas = snapshot(video);
    stopStream();
    onCapture(canvas, corners);
  };

  const pickFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = snapshot(img);
      URL.revokeObjectURL(url);
      stopStream();
      onCapture(canvas, defaultCorners(canvas.width, canvas.height));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError(t("That file couldn't be opened as a picture."));
    };
    img.src = url;
  };

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
      <div>
        <h2 className="text-lg font-bold">{t("Step 2: Photograph your card")}</h2>
        <p className="mt-1 text-sm text-slate-300">
          {t("Hold the card upright on a plain surface and fit its front inside the frame.")}
        </p>
      </div>

      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {status === "starting" && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">{t("Opening camera…")}</p>
        )}
        {status === "live" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              ref={frameRef}
              className="h-[86%] rounded-2xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
              style={{ aspectRatio: String(CARD_RATIO) }}
            />
          </div>
        )}
        {status === "failed" && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <Camera size={48} className="text-slate-600" />
          </div>
        )}
      </div>

      {error && <p className="w-full rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-200">{error}</p>}

      {status === "live" && (
        <button
          type="button"
          onClick={capture}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 font-semibold text-white hover:bg-sky-400"
        >
          <Camera size={18} /> {t("Capture card")}
        </button>
      )}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex items-center gap-1.5 text-sm font-medium text-slate-300 hover:text-white"
      >
        <ImageUp size={16} /> {t("Pick a photo instead")}
      </button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickFile} />
    </div>
  );
}

// Shows the whole photo with the card's outline; each corner can be dragged onto the real
// card corner. The SVG uses the photo's own pixel coordinates, so the corners need no
// conversion before flattening.
function AdjustStep({ photo, onRetake, onDone }) {
  const { canvas } = photo;
  const svgRef = useRef(null);
  const [corners, setCorners] = useState(photo.corners);
  const [dragging, setDragging] = useState(null);
  const [working, setWorking] = useState(false);
  const preview = useMemo(() => canvas.toDataURL("image/jpeg", 0.85), [canvas]);
  const handle = Math.max(canvas.width, canvas.height) * 0.025;

  const toPhoto = (event) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return {
      x: Math.max(0, Math.min(canvas.width, p.x)),
      y: Math.max(0, Math.min(canvas.height, p.y)),
    };
  };

  const onPointerMove = (event) => {
    if (dragging === null) return;
    const p = toPhoto(event);
    setCorners((prev) => prev.map((c, i) => (i === dragging ? p : c)));
  };

  const makeCard = () => {
    setWorking(true);
    // Let the "Creating…" label paint before the pixel work blocks the page briefly.
    setTimeout(() => {
      const dataUrl = flattenCard(canvas, corners);
      setWorking(false);
      onDone(dataUrl);
    }, 30);
  };

  // Keep the edited corners if the person goes back to this step from the review.
  photo.corners = corners;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
      <div>
        <h2 className="text-lg font-bold">{t("Step 3: Mark the card's corners")}</h2>
        <p className="mt-1 text-sm text-slate-300">
          {t("Drag each dot onto a corner of your card. We'll straighten it into a flat 2D card.")}
        </p>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${canvas.width} ${canvas.height}`}
        className="max-h-[60vh] w-full touch-none select-none rounded-2xl bg-black"
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
      >
        <image href={preview} width={canvas.width} height={canvas.height} />
        <polygon
          points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
          fill="rgba(56,189,248,0.15)"
          stroke="#38bdf8"
          strokeWidth={handle * 0.25}
        />
        {corners.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={handle}
            fill={dragging === i ? "#38bdf8" : "rgba(15,23,42,0.6)"}
            stroke="#fff"
            strokeWidth={handle * 0.25}
            className="cursor-grab"
            onPointerDown={(event) => {
              event.currentTarget.ownerSVGElement.setPointerCapture?.(event.pointerId);
              setDragging(i);
            }}
          />
        ))}
      </svg>

      <div className="flex w-full gap-3">
        <button
          type="button"
          onClick={onRetake}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/25 px-4 py-3 font-semibold hover:bg-white/10"
        >
          <RotateCcw size={16} /> {t("Retake")}
        </button>
        <button
          type="button"
          onClick={makeCard}
          disabled={working}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-500 px-4 py-3 font-semibold text-white hover:bg-sky-400 disabled:opacity-70"
        >
          <Sparkles size={16} /> {working ? t("Creating…") : t("Create 2D card")}
        </button>
      </div>
    </div>
  );
}

function ReviewStep({ image, uid, verified, onAdjust, onSave }) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
      <div>
        <h2 className="text-lg font-bold">{t("Step 4: Check your digital card")}</h2>
        <p className="mt-1 text-sm text-slate-300">{t("This is how your card will look on your phone.")}</p>
      </div>
      <img
        src={image}
        alt={t("Your digital MediCard")}
        className="max-h-[55vh] rounded-2xl shadow-2xl ring-1 ring-white/20"
        style={{ aspectRatio: String(CARD_RATIO) }}
      />
      <p className="flex items-center gap-1.5 text-sm text-slate-300">
        {verified ? <ShieldCheck size={16} className="text-emerald-400" /> : <Nfc size={16} />}
        <span className="font-mono tracking-widest">{uid}</span>
        <span>· {verified ? t("verified by NFC") : t("not verified by NFC")}</span>
      </p>
      <div className="flex w-full gap-3">
        <button
          type="button"
          onClick={onAdjust}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/25 px-4 py-3 font-semibold hover:bg-white/10"
        >
          <RotateCcw size={16} /> {t("Adjust corners")}
        </button>
        <button
          type="button"
          onClick={onSave}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-white hover:bg-emerald-400"
        >
          <Check size={16} /> {t("Save card")}
        </button>
      </div>
    </div>
  );
}

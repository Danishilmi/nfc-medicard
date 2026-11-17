import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ImageUp, Nfc, RotateCcw, ShieldCheck, Sparkles, X } from "lucide-react";
import { isNfcSupported, scanOnce } from "../lib/nfc.js";
import { CARD_RATIO, defaultCorners, flattenCard, normalizeUid, snapshot } from "../lib/digitalCard.js";
import { adviseShot, detectCard, isSteady, loadOpenCv } from "../lib/cardDetect.js";
import { t } from "../i18n/index.js";

// Full-screen flow that copies the patient's physical MediCard onto the phone:
//   1. NFC: scanning starts straight away; once the card is read and matches the patient's
//      registered card, the camera opens by itself,
//   2. camera: the card is found in the live picture, the person gets tips (closer, flatter,
//      more light, hold steady) and the photo is taken automatically once it's lined up,
//   3. the photo is flattened into a straight portrait 2D card, which the person reviews and saves.
// If the card can't be found in a photo, a fallback step lets the person mark its corners.
export default function CopyCardWizard({ registeredUid, onSave, onClose }) {
  const [step, setStep] = useState("nfc");
  const [uid, setUid] = useState(null);
  const [verified, setVerified] = useState(false);
  const [photo, setPhoto] = useState(null); // { canvas, corners } for the manual fallback
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
            onCard={(dataUrl) => {
              setImage(dataUrl);
              setStep("review");
            }}
            onNeedsCorners={(canvas, corners) => {
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
            onRetake={() => setStep("camera")}
            onSave={() => onSave({ uid, verified, image, copiedAt: new Date().toISOString() })}
          />
        )}
      </div>
    </div>
  );
}

function StepDots({ step }) {
  const steps = ["nfc", "camera", "review"];
  const at = step === "adjust" ? 1 : steps.indexOf(step);
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
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const startScan = useCallback(async () => {
    abortRef.current?.abort();
    setError(null);
    setScanning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const readUid = await scanOnce({ signal: controller.signal });
      if (normalizeUid(readUid) !== normalizeUid(registeredUid)) {
        setError(
          `${t("This card isn't the one registered to your account. Tap your own MediCard.")} ` +
            `(${t("Tapped card")}: ${normalizeUid(readUid)} · ${t("your account")}: ${normalizeUid(registeredUid)})`
        );
        return;
      }
      setSuccess(true);
      // Show the tick for a moment, then go straight to the camera.
      setTimeout(() => onDoneRef.current(normalizeUid(readUid), true), 700);
    } catch (err) {
      if (!controller.signal.aborted) setError(err?.message || t("Failed to read the NFC card. Try tapping it again."));
    } finally {
      setScanning(false);
    }
  }, [registeredUid]);

  // Start listening for the card as soon as this step opens (the "Copy my card" tap counts as
  // the user gesture Chrome needs for the NFC permission prompt).
  useEffect(() => {
    if (supported) startScan();
    return () => abortRef.current?.abort();
  }, [supported, startScan]);

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
      <div
        className={`flex h-28 w-28 items-center justify-center rounded-full ${
          success ? "bg-emerald-500/20" : "bg-sky-500/15"
        } ${scanning ? "animate-pulse" : ""}`}
      >
        {success ? <Check size={56} className="text-emerald-400" /> : <Nfc size={56} className="text-sky-400" />}
      </div>
      <div>
        <h2 className="text-lg font-bold">{success ? t("Card verified") : t("Step 1: Tap your card")}</h2>
        <p className="mt-1 text-sm text-slate-300">
          {success
            ? t("Opening the camera…")
            : supported
              ? t("Turn on NFC, then hold your physical MediCard against the back of your phone.")
              : t("This browser can't read NFC cards. Use Chrome on an Android phone with NFC turned on, or continue with your registered card number.")}
        </p>
      </div>

      {error && <p className="w-full rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</p>}

      {supported && !scanning && !success && (
        <button
          type="button"
          onClick={startScan}
          className="w-full rounded-xl bg-sky-500 px-4 py-3 font-semibold text-white hover:bg-sky-400"
        >
          {t("Scan again")}
        </button>
      )}
      {scanning && <p className="text-sm text-sky-300">{t("Waiting for your card…")}</p>}
      {!success && (
        <button
          type="button"
          onClick={() => {
            abortRef.current?.abort();
            onDone(normalizeUid(registeredUid), false);
          }}
          className="text-sm font-medium text-slate-400 underline-offset-2 hover:underline"
        >
          {t("Continue without NFC")}
        </button>
      )}
    </div>
  );
}

const STEADY_FRAMES = 6; // good, still frames in a row before the photo is taken (~1 s)
const DETECT_EVERY_MS = 160;

function CameraStep({ onCard, onNeedsCorners }) {
  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const fileRef = useRef(null);
  const streamRef = useRef(null);
  const cvRef = useRef(null);
  const capturedRef = useRef(false);
  const [status, setStatus] = useState("starting"); // starting | live | failed
  const [scanner, setScanner] = useState("loading"); // loading | ready | unavailable
  const [error, setError] = useState(null);
  const [detection, setDetection] = useState(null);
  const [advice, setAdvice] = useState(null);
  const [steadyCount, setSteadyCount] = useState(0);
  const [processing, setProcessing] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Open the camera.
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

  // Load the card detector alongside the camera.
  useEffect(() => {
    let cancelled = false;
    loadOpenCv()
      .then(({ cv }) => {
        if (cancelled) return;
        cvRef.current = cv;
        setScanner("ready");
      })
      .catch(() => {
        if (!cancelled) setScanner("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Turns a full-resolution photo into the 2D card, or hands it to the manual corner step when
  // the card can't be found in it.
  const finishPhoto = useCallback(
    (canvas, corners) => {
      setProcessing(true);
      setTimeout(() => {
        let found = corners;
        if (!found && cvRef.current) {
          try {
            found = detectCard(cvRef.current, canvas).corners;
          } catch {
            found = null;
          }
        }
        if (found) {
          onCard(flattenCard(canvas, found));
        } else {
          onNeedsCorners(canvas, defaultCorners(canvas.width, canvas.height));
        }
      }, 30);
    },
    [onCard, onNeedsCorners]
  );

  const captureNow = useCallback(
    (corners) => {
      const video = videoRef.current;
      if (!video?.videoWidth || capturedRef.current) return;
      capturedRef.current = true;
      if (navigator.vibrate) navigator.vibrate(60);
      const canvas = snapshot(video);
      stopStream();
      finishPhoto(canvas, corners || null);
    },
    [finishPhoto, stopStream]
  );

  // Watch the live picture: find the card, give a tip, and take the photo once it has been
  // lined up and still for a moment.
  useEffect(() => {
    if (status !== "live" || scanner !== "ready") return;
    let timer = null;
    let previous = null;
    let steady = 0;
    const tick = () => {
      const video = videoRef.current;
      if (!video?.videoWidth || capturedRef.current) return;
      let d = null;
      try {
        d = detectCard(cvRef.current, video, { viewAspect: 3 / 4 });
      } catch {
        d = null;
      }
      const a = adviseShot(d);
      if (a.ok && isSteady(d, previous)) steady += 1;
      else if (!a.ok) steady = 0;
      previous = d;
      setDetection(d);
      setAdvice(a);
      setSteadyCount(steady);
      if (steady >= STEADY_FRAMES) {
        captureNow(d.corners);
        return;
      }
      timer = setTimeout(tick, DETECT_EVERY_MS);
    };
    timer = setTimeout(tick, 300);
    return () => clearTimeout(timer);
  }, [status, scanner, captureNow]);

  // Without the detector, fall back to the on-screen guide frame as the card's outline.
  const guideCorners = () => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame) return null;
    const box = video.getBoundingClientRect();
    const rect = frame.getBoundingClientRect();
    const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
    const offsetX = (box.width - video.videoWidth * scale) / 2;
    const offsetY = (box.height - video.videoHeight * scale) / 2;
    const toSource = (px, py) => ({ x: (px - box.left - offsetX) / scale, y: (py - box.top - offsetY) / scale });
    return [
      toSource(rect.left, rect.top),
      toSource(rect.right, rect.top),
      toSource(rect.right, rect.bottom),
      toSource(rect.left, rect.bottom),
    ];
  };

  const pickFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      const canvas = snapshot(img);
      URL.revokeObjectURL(url);
      capturedRef.current = true;
      stopStream();
      // Wait for the detector if it's still loading, so the photo is flattened automatically.
      if (!cvRef.current) {
        setProcessing(true);
        try {
          cvRef.current = (await loadOpenCv()).cv;
        } catch {
          // carry on without it: the corner step takes over
        }
      }
      finishPhoto(canvas, null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError(t("That file couldn't be opened as a picture."));
    };
    img.src = url;
  };

  const video = videoRef.current;
  const good = advice?.ok;
  const tip =
    status !== "live"
      ? null
      : scanner === "loading"
        ? t("Preparing the card scanner…")
        : scanner === "unavailable"
          ? t("Line your card up with the frame, then tap Take photo.")
          : t(advice?.tip || "Place your card inside the frame, on a plain darker surface.");

  if (processing) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <Sparkles size={40} className="animate-pulse text-sky-400" />
        <p className="text-lg font-bold">{t("Creating your 2D card…")}</p>
        <p className="text-sm text-slate-300">{t("Straightening the photo and cleaning up the colours.")}</p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
      <div>
        <h2 className="text-lg font-bold">{t("Step 2: Photograph your card")}</h2>
        <p className="mt-1 text-sm text-slate-300">
          {t("Lay the card upright on a plain surface and point your camera at it. The photo is taken for you.")}
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
              className={`h-[80%] rounded-2xl border-2 border-dashed ${
                detection?.corners ? "border-white/30" : "border-white/80"
              } shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]`}
              style={{ aspectRatio: String(CARD_RATIO) }}
            />
          </div>
        )}
        {status === "live" && video?.videoWidth > 0 && detection?.corners && (
          // Same coordinate space as the video, scaled the same way as object-cover.
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${video.videoWidth} ${video.videoHeight}`}
            preserveAspectRatio="xMidYMid slice"
          >
            <polygon
              points={detection.corners.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={good ? "rgba(16,185,129,0.18)" : "rgba(245,158,11,0.12)"}
              stroke={good ? "#10b981" : "#f59e0b"}
              strokeWidth={Math.max(video.videoWidth, video.videoHeight) * 0.006}
              strokeLinejoin="round"
            />
          </svg>
        )}
        {tip && (
          <div className="absolute inset-x-3 bottom-3">
            <p
              className={`rounded-xl px-3 py-2 text-sm font-semibold backdrop-blur ${
                good ? "bg-emerald-500/85 text-white" : "bg-slate-900/80 text-white"
              }`}
              aria-live="polite"
            >
              {tip}
            </p>
            {good && (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full bg-emerald-400 transition-all"
                  style={{ width: `${Math.min(100, (steadyCount / STEADY_FRAMES) * 100)}%` }}
                />
              </div>
            )}
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
          onClick={() => captureNow(scanner === "ready" ? detection?.corners : guideCorners())}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-300 hover:text-white"
        >
          <Camera size={16} /> {t("Take photo now")}
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

// Fallback only, when the card couldn't be found in the photo: the whole photo with the
// card's outline, whose corners can be dragged onto the real card corners.
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
    setTimeout(() => {
      const dataUrl = flattenCard(canvas, corners);
      setWorking(false);
      onDone(dataUrl);
    }, 30);
  };

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
      <div>
        <h2 className="text-lg font-bold">{t("We couldn't find the card's edges")}</h2>
        <p className="mt-1 text-sm text-slate-300">
          {t("Drag each dot onto a corner of your card, or retake the photo on a plain darker surface.")}
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

function ReviewStep({ image, uid, verified, onRetake, onSave }) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
      <div>
        <h2 className="text-lg font-bold">{t("Step 3: Your 2D card")}</h2>
        <p className="mt-1 text-sm text-slate-300">{t("This is how your card will look on your phone.")}</p>
      </div>
      <img
        src={image}
        alt={t("Your digital MediCard")}
        className="w-auto max-w-full shrink-0 rounded-2xl shadow-2xl ring-1 ring-white/20"
        style={{ height: "52vh", aspectRatio: String(CARD_RATIO) }}
      />
      <p className="flex items-center gap-1.5 text-sm text-slate-300">
        {verified ? <ShieldCheck size={16} className="text-emerald-400" /> : <Nfc size={16} />}
        <span className="font-mono tracking-widest">{uid}</span>
        <span>· {verified ? t("verified by NFC") : t("not verified by NFC")}</span>
      </p>
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
          onClick={onSave}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-white hover:bg-emerald-400"
        >
          <Check size={16} /> {t("Save card")}
        </button>
      </div>
    </div>
  );
}

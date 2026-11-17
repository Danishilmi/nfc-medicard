import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QrCode, Download, Droplet, CreditCard, Maximize2, RotateCcw, ShieldCheck, Trash2, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import Card from "../../components/Card.jsx";
import Avatar from "../../components/Avatar.jsx";
import EmptyState from "../../components/EmptyState.jsx";
import CopyCardWizard from "../../components/CopyCardWizard.jsx";
import { CARD_RATIO, loadDigitalCard, removeDigitalCard, saveDigitalCard } from "../../lib/digitalCard.js";
import { t } from "../../i18n/index.js";

export default function PatientQrCode() {
  const { profile } = useAuth();
  const toast = useToast();
  const [dataUrl, setDataUrl] = useState(null);
  const [digitalCard, setDigitalCard] = useState(null);
  const [copying, setCopying] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const cardUid = profile?.cardUid;
  const userId = profile?.uid;

  useEffect(() => {
    if (!cardUid) return;
    let active = true;
    QRCode.toDataURL(cardUid, { width: 480, margin: 1 }).then((url) => {
      if (active) setDataUrl(url);
    });
    return () => {
      active = false;
    };
  }, [cardUid]);

  useEffect(() => {
    const saved = loadDigitalCard(userId);
    // A copy made from a card that has since been replaced no longer counts.
    setDigitalCard(saved && saved.uid === cardUid ? saved : null);
  }, [userId, cardUid]);

  if (!profile) return null;

  const handleSave = (card) => {
    if (!saveDigitalCard(userId, card)) {
      toast?.error?.(t("Couldn't save the card on this phone. Free up some space and try again."));
      return;
    }
    setDigitalCard(card);
    setCopying(false);
    toast?.success?.(t("Your card is copied to this phone."));
  };

  const handleRemove = () => {
    if (!window.confirm(t("Remove the digital card from this phone? Your physical card keeps working."))) return;
    removeDigitalCard(userId);
    setDigitalCard(null);
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t("My QR Code")}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("Show this to hospital staff if your card isn't with you — it works just like tapping it.")}
        </p>
      </div>

      {!cardUid ? (
        <EmptyState
          icon={QrCode}
          title={t("No card registered yet")}
          subtitle={t("Visit the registration desk to get your MediCard. Your QR code will appear here once it's issued.")}
        />
      ) : (
        <>
          <Card>
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <div className="flex items-center gap-3">
                <Avatar name={profile.name} url={profile.avatarUrl} size="sm" />
                <div className="text-left">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{profile.name}</p>
                  {profile.bloodType && (
                    <p className="flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
                      <Droplet size={12} /> {profile.bloodType}
                    </p>
                  )}
                </div>
              </div>

              {dataUrl && (
                <img
                  src={dataUrl}
                  alt={t("Your MediCard QR code")}
                  className="w-full max-w-[280px] rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700"
                />
              )}

              <p className="font-mono text-sm tracking-widest text-slate-500 dark:text-slate-400">{cardUid}</p>

              {dataUrl && (
                <a
                  href={dataUrl}
                  download={`medicard-${cardUid}.png`}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Download size={15} /> {t("Save to phone")}
                </a>
              )}
            </div>
          </Card>

          {digitalCard ? (
            <Card>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-slate-800 dark:text-slate-100">{t("My digital card")}</h2>
                  {digitalCard.verified && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      <ShieldCheck size={12} /> {t("Verified by NFC")}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPresenting(true)}
                  className="mx-auto block w-full max-w-[240px] overflow-hidden rounded-2xl shadow-lg ring-1 ring-slate-200 transition hover:scale-[1.01] dark:ring-slate-700"
                  aria-label={t("Show card full screen")}
                >
                  <img
                    src={digitalCard.image}
                    alt={t("Your digital MediCard")}
                    className="w-full object-cover"
                    style={{ aspectRatio: String(CARD_RATIO) }}
                  />
                </button>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPresenting(true)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500"
                  >
                    <Maximize2 size={15} /> {t("Show at counter")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCopying(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <RotateCcw size={15} /> {t("Copy again")}
                  </button>
                  <button
                    type="button"
                    onClick={handleRemove}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-slate-700 dark:text-red-400 dark:hover:bg-red-500/10"
                    aria-label={t("Remove digital card")}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="flex flex-col items-center gap-3 py-1 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300">
                  <CreditCard size={24} />
                </div>
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{t("Carry your card on your phone")}</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {t("Tap your physical MediCard on your phone and take a photo of it to make a digital copy.")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCopying(true)}
                  className="w-full rounded-xl bg-sky-600 px-4 py-3 font-semibold text-white hover:bg-sky-500"
                >
                  {t("Copy my card")}
                </button>
              </div>
            </Card>
          )}
        </>
      )}

      {copying && (
        <CopyCardWizard registeredUid={cardUid} onSave={handleSave} onClose={() => setCopying(false)} />
      )}

      {presenting && digitalCard && (
        <PresentCard card={digitalCard} qr={dataUrl} name={profile.name} onClose={() => setPresenting(false)} />
      )}
    </div>
  );
}

// Full-screen view to hold up at the hospital counter: the card photo plus the QR code staff
// scan to look the patient up, exactly as when the physical card is tapped.
function PresentCard({ card, qr, name, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex overflow-y-auto bg-white p-6 dark:bg-slate-950" role="dialog" aria-modal="true">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-label={t("Close")}
      >
        <X size={22} />
      </button>
      <div className="m-auto flex flex-col items-center gap-4">
      <img
        src={card.image}
        alt={t("Your digital MediCard")}
        className="w-auto max-w-full shrink-0 rounded-2xl object-cover shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700"
        style={{ height: "55vh", aspectRatio: String(CARD_RATIO) }}
      />
      <p className="font-semibold text-slate-800 dark:text-slate-100">{name}</p>
      {qr && <img src={qr} alt={t("Your MediCard QR code")} className="w-36 shrink-0 rounded-xl border border-slate-200 bg-white p-2" />}
      <p className="font-mono text-sm tracking-widest text-slate-500 dark:text-slate-400">{card.uid}</p>
      </div>
    </div>
  );
}

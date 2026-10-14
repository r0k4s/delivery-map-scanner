import { useCallback, useEffect, useRef, useState } from 'react';
import { saveSettings } from '../lib/db';
import { frameDiff, sampleFrame, type FrameSample } from '../lib/frame';
import { REVIEW_THRESHOLD } from '../lib/labelParser';
import { geocodeAddress, type GeoResult } from '../lib/maps';
import { getOcrWorker, OcrUnavailableError, onOcrProgress, type CropRect } from '../lib/ocr';
import { hasAnyAddress, readLabel, type LabelRead } from '../lib/scan';
import { addDelivery, deleteDeliveries, findByTracking, geoFromResult } from '../lib/store';
import { streetLine, type Delivery, type Settings, type Template } from '../types';
import { EditSheet, type EditValues } from './EditSheet';
import { ScanQuickEdit } from './ScanQuickEdit';
import { useToast } from './Toast';
import { Icon } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  templates: Template[];
  scannedCount: number;
}

interface Review {
  read: LabelRead;
  geo: GeoResult | null;
  geoPending: boolean;
  duplicateOf: Delivery | null;
}

type Phase = 'starting' | 'searching' | 'steady' | 'reading' | 'review' | 'error';

// Auto-capture tuning (values are on a 200px-wide grayscale sample of the frame)
const STABLE_DIFF = 5.5; // mean abs pixel change below this = camera is steady
const SCENE_CHANGE = 20; // above this = a new label is in view
const MIN_SHARPNESS = 120; // label text gives a much higher Laplacian variance than a blank surface
const STEADY_SAMPLES = 2;

export function Scanner({ open, onClose, settings, templates, scannedCount }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [hint, setHint] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [ocrLoading, setOcrLoading] = useState<number | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [flash, setFlash] = useState(false);
  const toast = useToast();

  const busy = useRef(false);
  const loop = useRef({ prev: null as FrameSample | null, ref: null as FrameSample | null, armed: true, rearmAt: 0, steady: 0, maxSharp: 0 });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const templatesRef = useRef(templates);
  templatesRef.current = templates;

  // ------------------------------------------------------------ camera
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('starting');
    setCameraError('');
    setReview(null);
    busy.current = false;
    loop.current = { prev: null, ref: null, armed: true, rearmAt: 0, steady: 0, maxSharp: 0 };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera is not available in this browser. You can still upload a label photo.');
        setPhase('error');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const caps: any = track.getCapabilities?.() ?? {};
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }).catch(() => {});
        }
        setTorchSupported(!!caps.torch);
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setPhase('searching');
      } catch (e) {
        const name = (e as DOMException).name;
        setCameraError(
          name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access in your browser settings, or upload a label photo.'
            : 'Could not start the camera. You can still upload a label photo.',
        );
        setPhase('error');
      }
    })();

    // Warm up OCR while the camera starts
    const off = onOcrProgress((status, progress) => {
      if (status.includes('loading') || status.includes('initializ')) setOcrLoading(progress);
    });
    getOcrWorker()
      .then(() => setOcrLoading(null))
      .catch(() => {
        setOcrLoading(null);
        setHint('Text recognition could not load – check your connection');
      });

    return () => {
      cancelled = true;
      off();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setTorchOn(false);
    };
  }, [open]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await track.applyConstraints({ advanced: [{ torch: next } as any] }).catch(() => {});
    setTorchOn(next);
  }

  const crop = useCallback((): CropRect | undefined => {
    const v = videoRef.current;
    const f = frameRef.current;
    if (!v || !f || !v.videoWidth) return undefined;
    const vr = v.getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight);
    const offX = (vr.width - v.videoWidth * scale) / 2;
    const offY = (vr.height - v.videoHeight * scale) / 2;
    const pad = 0.04;
    let x = (fr.left - vr.left - offX) / scale / v.videoWidth - pad;
    let y = (fr.top - vr.top - offY) / scale / v.videoHeight - pad;
    let w = fr.width / scale / v.videoWidth + pad * 2;
    let h = fr.height / scale / v.videoHeight + pad * 2;
    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.min(1 - x, w);
    h = Math.min(1 - y, h);
    return { x, y, w, h };
  }, []);

  // ------------------------------------------------------------ saving
  const feedback = useCallback(() => {
    navigator.vibrate?.(60);
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 1046;
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.12);
      o.onended = () => ctx.close();
    } catch {
      /* sound is optional */
    }
    setFlash(true);
    window.setTimeout(() => setFlash(false), 350);
  }, []);

  const announceSaved = useCallback(
    (d: Delivery) => {
      const where = d.geoStatus === 'pending' ? 'Saved – will appear on the map when online' : d.geoStatus === 'failed' ? 'Saved without map position' : 'Added to map';
      toast.show({
        tone: d.geoStatus === 'ok' || d.geoStatus === 'manual' ? 'success' : 'warn',
        message: `#${d.seq} ${streetLine(d)}`,
        sub: `${d.postcode} ${d.city} · ${where}`,
        duration: 6000,
        position: 'top',
        actions: [
          {
            label: 'Undo',
            onClick: () => {
              deleteDeliveries([d.id]);
            },
          },
        ],
        body: <ScanQuickEdit id={d.id} templates={templatesRef.current} />,
      });
      feedback();
    },
    [toast, feedback],
  );

  const resumeAfter = useCallback(() => {
    // Require the current label to leave the frame before auto-capturing again
    const v = videoRef.current;
    const c = crop();
    loop.current.ref = v && c ? sampleFrame(v, c) : null;
    loop.current.armed = false;
    loop.current.rearmAt = Date.now() + 4000;
    loop.current.steady = 0;
    busy.current = false;
    setPhase('searching');
  }, [crop]);

  const handleRead = useCallback(
    async (read: LabelRead, source: 'auto' | 'manual' | 'upload') => {
      const s = settingsRef.current;
      const p = read.parsed;

      if (!hasAnyAddress(p) && source === 'auto') {
        setHint('No address found – move closer to the SHIP TO block');
        loop.current.armed = false;
        loop.current.rearmAt = Date.now() + 1500;
        loop.current.ref = null;
        busy.current = false;
        setPhase('searching');
        return;
      }

      const duplicateOf = (await findByTracking(p.tracking)) ?? null;
      const confident = p.confidence >= REVIEW_THRESHOLD;

      if (duplicateOf && confident && source === 'auto') {
        toast.show({
          tone: 'warn',
          position: 'top',
          message: `Already scanned as #${duplicateOf.seq}`,
          sub: `${streetLine(duplicateOf)} · ${duplicateOf.tracking}`,
          actions: [{ label: 'Add anyway', onClick: () => openReview(read, null, false, duplicateOf) }],
        });
        navigator.vibrate?.([40, 60, 40]);
        resumeAfter();
        return;
      }

      // Look the address up on the map (needed for both auto-save and review)
      let geo: GeoResult | null = null;
      let geoPending = false;
      if (p.address.street && p.address.postcode) {
        setHint('Finding address on the map…');
        try {
          geo = await geocodeAddress(s.apiKey, p.address);
        } catch {
          geoPending = true; // offline or no key: keep it local and geocode later
        }
      }

      const geoGood = geo?.status === 'ok' || (geoPending && confident);
      if (confident && s.autoSave && !duplicateOf && geoGood) {
        const d = await addDelivery({
          address: p.address,
          tracking: p.tracking,
          color: s.defaultColor,
          templateId: s.defaultTemplateId,
          note: '',
          geo: geo ? geoFromResult(geo) : { status: 'pending', lat: null, lng: null, formatted: '' },
        });
        setHint('');
        announceSaved(d);
        resumeAfter();
        return;
      }
      openReview(read, geo, geoPending, duplicateOf);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, announceSaved, resumeAfter],
  );

  function openReview(read: LabelRead, geo: GeoResult | null, geoPending: boolean, duplicateOf: Delivery | null) {
    busy.current = true;
    setHint('');
    setPhase('review');
    setReview({ read, geo, geoPending, duplicateOf });
  }

  const capture = useCallback(
    async (source: 'auto' | 'manual') => {
      const v = videoRef.current;
      if (busy.current || !v || !v.videoWidth) return;
      busy.current = true;
      setPhase('reading');
      setHint('Reading label…');
      try {
        const read = await readLabel(v, crop());
        await handleRead(read, source);
      } catch (e) {
        console.error(e);
        setHint(e instanceof OcrUnavailableError ? 'Text recognition is still loading – check your internet connection' : 'Could not read the label – try again');
        busy.current = false;
        setPhase('searching');
      }
    },
    [crop, handleRead],
  );

  async function onUpload(file: File | undefined) {
    if (!file) return;
    if (busy.current) {
      setHint('Still reading the previous label – try again in a moment');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    busy.current = true;
    setPhase('reading');
    setHint('Reading photo…');
    try {
      const bitmap = await createImageBitmap(file);
      const read = await readLabel(bitmap, undefined, true);
      bitmap.close();
      await handleRead(read, 'upload');
    } catch (e) {
      console.error(e);
      setHint('Could not read that photo');
      busy.current = false;
      setPhase(cameraError ? 'error' : 'searching');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // ------------------------------------------------------------ auto-capture loop
  useEffect(() => {
    if (!open || !settings.autoCapture) return;
    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || busy.current || ocrLoading !== null || !v.videoWidth) return;
      const c = crop();
      if (!c) return;
      const s = sampleFrame(v, c);
      if (!s) return;
      const L = loop.current;
      L.maxSharp = Math.max(L.maxSharp * 0.99, s.sharpness);

      if (!L.armed) {
        const changed = L.ref ? frameDiff(s, L.ref) > SCENE_CHANGE : false;
        if (changed || (!L.ref && Date.now() > L.rearmAt) || Date.now() > L.rearmAt + 6000) {
          L.armed = true;
          L.ref = null;
        } else {
          L.prev = s;
          return;
        }
      }

      const diff = L.prev ? frameDiff(s, L.prev) : 255;
      L.prev = s;
      const sharpEnough = s.sharpness > MIN_SHARPNESS && s.sharpness > L.maxSharp * 0.5;
      if (diff < STABLE_DIFF && sharpEnough) {
        L.steady++;
        setPhase((p) => (p === 'searching' ? 'steady' : p));
        if (L.steady >= STEADY_SAMPLES) {
          L.steady = 0;
          capture('auto');
        }
      } else {
        L.steady = 0;
        setPhase((p) => (p === 'steady' ? 'searching' : p));
      }
    }, 350);
    return () => window.clearInterval(id);
  }, [open, settings.autoCapture, crop, capture, ocrLoading]);

  // ------------------------------------------------------------ review sheet handlers
  async function saveReview(v: EditValues) {
    const d = await addDelivery(v);
    setReview(null);
    announceSaved(d);
    resumeAfter();
  }

  function retake() {
    setReview(null);
    loop.current.armed = true;
    loop.current.ref = null;
    busy.current = false;
    setPhase('searching');
  }

  if (!open) return null;

  const r = review;
  const reviewInitial: (EditValues & { geoReason?: string }) | null = r
    ? {
        address: r.read.parsed.address,
        tracking: r.read.parsed.tracking,
        color: settings.defaultColor,
        templateId: settings.defaultTemplateId,
        note: '',
        geo: r.geo
          ? geoFromResult(r.geo)
          : { status: r.geoPending ? 'pending' : 'failed', lat: null, lng: null, formatted: '' },
        geoReason: r.geo?.reason ?? (r.geoPending ? 'Map lookup unavailable right now' : ''),
      }
    : null;

  const statusText =
    ocrLoading !== null
      ? `Preparing text recognition… ${Math.round(ocrLoading * 100)}%`
      : hint ||
        (phase === 'steady'
          ? 'Hold steady…'
          : phase === 'reading'
            ? 'Reading label…'
            : settings.autoCapture
              ? 'Fit the SHIP TO address in the frame'
              : 'Fit the SHIP TO address in the frame and tap the button');

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-black text-white select-none">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />

      {/* Darkened surround with a clear scan window */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 64px)', paddingBottom: 190 }}>
        <div
          ref={frameRef}
          className={`relative aspect-[4/3] w-[88%] max-w-[520px] rounded-3xl transition-shadow duration-200 ${phase === 'steady' || phase === 'reading' ? 'scan-frame-active' : ''}`}
          style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
        >
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <span key={c} className={`scan-corner scan-corner-${c} ${phase === 'reading' ? 'border-accent' : phase === 'steady' ? 'border-emerald-400' : 'border-white'}`} />
          ))}
          <span className="absolute top-3 left-4 rounded-md bg-black/50 px-2 py-0.5 text-xs font-bold tracking-widest text-white/90">SHIP TO</span>
          {phase === 'reading' && <div className="scan-line" />}
        </div>
      </div>

      {flash && <div className="pointer-events-none absolute inset-0 bg-emerald-400/35 animate-fade-out" />}

      {/* Top bar */}
      <div className="relative z-10 flex items-center gap-2 px-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <button onClick={onClose} className="grid h-12 w-12 place-items-center rounded-full bg-black/50 backdrop-blur" aria-label="Close scanner">
          <Icon name="x" size={26} />
        </button>
        <div className="flex-1 text-center">
          <div className="text-xs font-semibold tracking-widest text-white/60 uppercase">Scanned</div>
          <div className="text-2xl leading-none font-black tabular-nums">{scannedCount}</div>
        </div>
        <button
          onClick={() => saveSettings({ autoCapture: !settings.autoCapture })}
          className={`flex h-12 items-center gap-1.5 rounded-full px-4 text-sm font-bold backdrop-blur ${settings.autoCapture ? 'bg-accent text-ink' : 'bg-black/50 text-white'}`}
          aria-pressed={settings.autoCapture}
        >
          <Icon name="auto" size={18} /> Auto
        </button>
        {torchSupported && (
          <button onClick={toggleTorch} className={`grid h-12 w-12 place-items-center rounded-full backdrop-blur ${torchOn ? 'bg-accent text-ink' : 'bg-black/50'}`} aria-label="Toggle flashlight" aria-pressed={torchOn}>
            <Icon name="bolt" />
          </button>
        )}
      </div>

      {cameraError && (
        <div className="relative z-10 mx-4 mt-6 rounded-2xl bg-white/10 p-4 text-center backdrop-blur">
          <Icon name="alert" className="mx-auto mb-2" />
          {cameraError}
        </div>
      )}

      <div className="flex-1" />

      {/* Bottom controls */}
      <div className="relative z-10 px-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <div className="mb-5 flex min-h-12 items-center justify-center text-center">
          <span className="rounded-full bg-black/55 px-4 py-2 text-base font-semibold backdrop-blur" aria-live="polite">
            {phase === 'reading' && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent align-[-1px]" />}
            {statusText}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <button onClick={() => fileRef.current?.click()} className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15 backdrop-blur" aria-label="Upload label photo">
            <Icon name="image" size={26} />
          </button>
          <button
            onClick={() => capture('manual')}
            disabled={phase === 'reading' || phase === 'error' || phase === 'starting'}
            className="grid h-[84px] w-[84px] place-items-center rounded-full border-[5px] border-white/90 disabled:opacity-40"
            aria-label="Capture label"
          >
            <span className={`block h-[64px] w-[64px] rounded-full transition-transform active:scale-90 ${phase === 'reading' ? 'bg-accent' : 'bg-white'}`} />
          </button>
          <button onClick={onClose} className="flex h-14 min-w-14 items-center justify-center rounded-2xl bg-white/15 px-3 text-sm font-bold backdrop-blur">
            Done
          </button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />

      {r && reviewInitial && (
        <EditSheet
          open
          mode="review"
          initial={reviewInitial}
          apiKey={settings.apiKey}
          mapId={settings.mapId}
          templates={templates}
          thumb={r.read.thumb}
          issues={[
            ...r.read.parsed.issues,
            ...(r.geo && r.geo.status !== 'ok' ? [r.geo.reason] : []),
            ...(r.read.parsed.tracking && !r.read.parsed.trackingValid ? ['Tracking number check digit did not match – verify it'] : []),
          ]}
          duplicateOf={r.duplicateOf}
          onSave={saveReview}
          onCancel={retake}
          onRetake={retake}
          onSkip={() => {
            setReview(null);
            resumeAfter();
          }}
        />
      )}
    </div>
  );
}

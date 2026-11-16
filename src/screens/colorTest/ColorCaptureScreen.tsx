import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { saveShot } from '../../data/colorTestRepo';
import { processImage, type ProcessedImage } from '../../data/images';
import { testColorLabel, testColorSwatch, type ColorTest, type TestColor } from '../../domain/colorTest';
import type { Photo } from '../../domain/types';
import { grabFrame, useCamera, type CameraFacing } from '../../ui/camera';
import { StoredImage } from '../../ui/controls';
import { isTestColor, useColorTestData } from './shared';

const TIMERS = [
  { seconds: 0, label: 'Off' },
  { seconds: 3, label: '3 s' },
  { seconds: 10, label: '10 s' },
] as const;

type TimerSeconds = (typeof TIMERS)[number]['seconds'];

export function ColorCaptureScreen() {
  const { color } = useParams();
  const data = useColorTestData();

  if (!data) return <div className="capture" aria-busy="true" />;
  if (!data.test || !isTestColor(color) || !data.test.colors.includes(color)) return <Navigate to="/color-test" replace />;
  return <Capture test={data.test} color={color} photos={data.photos} />;
}

/** The earliest photo of another color. It is shown faintly over the camera so every shot lines up with it. */
function referencePhoto(test: ColorTest, color: TestColor, photos: Map<TestColor, Photo>): Photo | undefined {
  const earliest = test.shots
    .filter((s) => s.color !== color && photos.has(s.color))
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt))[0];
  return earliest ? photos.get(earliest.color) : undefined;
}

function Capture({ test, color, photos }: { test: ColorTest; color: TestColor; photos: Map<TestColor, Photo> }) {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<CameraFacing>('user');
  const [taken, setTaken] = useState<ProcessedImage>();
  const [timer, setTimer] = useState<TimerSeconds>(3);
  const [countdown, setCountdown] = useState<number>();
  const [guide, setGuide] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const camera = useCamera(videoRef, facing, taken === undefined);

  const label = testColorLabel(color);
  const lower = label.toLowerCase();
  const position = test.colors.indexOf(color) + 1;
  const reference = referencePhoto(test, color, photos);
  const hasPhoto = test.shots.some((s) => s.color === color);

  /** The next color in order that still has no photo, looking past this one and wrapping round. */
  function nextColor(): TestColor | undefined {
    const done = new Set(test.shots.map((s) => s.color));
    done.add(color);
    const start = test.colors.indexOf(color);
    for (let step = 1; step < test.colors.length; step++) {
      const candidate = test.colors[(start + step) % test.colors.length]!;
      if (!done.has(candidate)) return candidate;
    }
    return undefined;
  }

  function goOn() {
    const next = nextColor();
    setTaken(undefined);
    setError(undefined);
    navigate(next ? `/color-test/capture/${next}` : '/color-test', { replace: true });
  }

  async function shoot() {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    setError(undefined);
    try {
      setTaken(await processImage(await grabFrame(video, facing === 'user')));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The photo could not be taken.');
    } finally {
      setBusy(false);
    }
  }

  // The countdown: one tick a second, then the photo.
  useEffect(() => {
    if (countdown === undefined) return;
    const id = setTimeout(() => {
      if (countdown <= 1) {
        setCountdown(undefined);
        void shoot();
      } else {
        setCountdown(countdown - 1);
      }
    }, 1000);
    return () => clearTimeout(id);
    // `shoot` reads only refs and state setters, so it is safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  function onShutter() {
    if (countdown !== undefined) return setCountdown(undefined);
    if (timer === 0) void shoot();
    else setCountdown(timer);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      setTaken(await processImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That photo could not be used.');
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    if (!taken) return;
    setBusy(true);
    try {
      await saveShot(color, taken);
      goOn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The photo could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const live = camera.status === 'live';

  return (
    <div className="capture">
      <header className="capture-top">
        <Link className="capture-link" to="/color-test">
          ‹ Done
        </Link>
        <h1 className="capture-title">
          <span className="dot" style={{ background: testColorSwatch(color) }} aria-hidden="true" />
          {label}
          <span className="capture-count">
            {position} of {test.colors.length}
          </span>
        </h1>
        <button type="button" className="capture-link" onClick={goOn}>
          Skip
        </button>
      </header>

      <div className="viewfinder">
        {taken ? (
          <StoredImage bytes={taken.data} mimeType={taken.mimeType} alt={`The photo you just took with ${lower}`} className="viewfinder-media" />
        ) : (
          <>
            <video ref={videoRef} className={facing === 'user' ? 'viewfinder-media mirrored' : 'viewfinder-media'} playsInline muted autoPlay />
            {live && guide && reference && <StoredImage bytes={reference.data} mimeType={reference.mimeType} alt="" className="viewfinder-media ghost" />}
            {live && (
              <>
                <div className="face-guide" aria-hidden="true" />
                <div className="drape-guide" style={{ borderColor: testColorSwatch(color) }} aria-hidden="true">
                  <span>{label} here, right up to your chin</span>
                </div>
              </>
            )}
            {camera.status === 'starting' && <p className="viewfinder-note">Starting the camera</p>}
            {camera.status === 'unavailable' && (
              <div className="viewfinder-note">
                <p>The camera did not open inside the app. You can still take the photo with the phone's own camera.</p>
                <p>Frame your face in the top half and the {lower} under your chin, the same way every time.</p>
              </div>
            )}
            {countdown !== undefined && (
              <p className="countdown" role="status" aria-live="assertive">
                {countdown}
              </p>
            )}
          </>
        )}
      </div>

      {error && (
        <p className="capture-error" role="alert">
          {error}
        </p>
      )}

      {taken ? (
        <div className="capture-controls">
          <p className="capture-hint">Face sharp, {lower} right under your chin, same light as before?</p>
          <div className="capture-row">
            <button type="button" className="btn capture-btn" disabled={busy} onClick={() => setTaken(undefined)}>
              Retake
            </button>
            <button type="button" className="btn btn-primary capture-btn capture-btn-main" disabled={busy} onClick={() => void keep()}>
              Use this photo
            </button>
          </div>
        </div>
      ) : live ? (
        <div className="capture-controls">
          <p className="capture-hint">
            {hasPhoto
              ? `A new photo replaces the one you have for ${lower}, and clears its picks.`
              : reference
                ? 'Line your face up with the faint copy of your first photo.'
                : 'Fit your face in the oval. Every later photo lines up with this one.'}
          </p>
          <div className="capture-row capture-options">
            <div className="segmented segmented-dark" role="group" aria-label="Timer">
              {TIMERS.map((t) => (
                <button key={t.seconds} type="button" aria-pressed={timer === t.seconds} onClick={() => setTimer(t.seconds)}>
                  {t.seconds === 0 ? 'No timer' : t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="capture-row capture-shutter-row">
            {reference ? (
              <button type="button" className="capture-link" aria-pressed={guide} onClick={() => setGuide(!guide)}>
                {guide ? 'Hide line-up' : 'Show line-up'}
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="shutter" disabled={busy} onClick={onShutter} aria-label={countdown !== undefined ? 'Cancel the timer' : `Take the ${lower} photo`}>
              <span />
            </button>
            <button type="button" className="capture-link" onClick={() => {
                setCountdown(undefined);
                setFacing(facing === 'user' ? 'environment' : 'user');
              }}
            >
              {facing === 'user' ? 'Back camera' : 'Front camera'}
            </button>
          </div>
          <button type="button" className="capture-link capture-alt" onClick={() => libraryInput.current?.click()}>
            Use a photo from your library instead
          </button>
        </div>
      ) : (
        <div className="capture-controls">
          {camera.status === 'unavailable' && (
            <>
              <button type="button" className="btn btn-primary capture-btn" disabled={busy} onClick={() => cameraInput.current?.click()}>
                Open the phone's camera
              </button>
              <div className="capture-row">
                <button type="button" className="btn capture-btn" disabled={busy} onClick={() => libraryInput.current?.click()}>
                  Choose a photo
                </button>
                <button type="button" className="btn capture-btn" disabled={busy} onClick={camera.retry}>
                  Try again
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="user"
        className="visually-hidden"
        aria-label={`Take the ${lower} photo with the phone's camera`}
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={libraryInput}
        type="file"
        accept="image/*"
        className="visually-hidden"
        aria-label={`Choose a ${lower} photo`}
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

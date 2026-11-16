import { useEffect, useState, type RefObject } from 'react';

export type CameraFacing = 'user' | 'environment';
export type CameraStatus = 'idle' | 'starting' | 'live' | 'unavailable';

/** Width over height of a color-test photo. Portrait, like a head-and-shoulders shot. */
export const PORTRAIT_ASPECT = 3 / 4;

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/**
 * Runs the phone's camera into a <video> while `active` is true, and stops it
 * when the screen is left. The camera restarts when the app comes back to the
 * front, because iPhone freezes the picture of an app that was in the
 * background.
 */
export function useCamera(videoRef: RefObject<HTMLVideoElement | null>, facing: CameraFacing, active: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<{ key: string; status: 'live' | 'unavailable' }>();
  const supported = cameraSupported();
  const key = `${facing}:${attempt}`;

  useEffect(() => {
    if (!active || !supported) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    const video = videoRef.current;

    navigator.mediaDevices
      .getUserMedia({ audio: false, video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } } })
      .then(async (started) => {
        if (stopped) {
          started.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = started;
        if (video) {
          video.srcObject = started;
          try {
            await video.play();
          } catch {
            // Playing can be refused while the page is hidden. The picture starts when it is shown.
          }
        }
        if (!stopped) setOutcome({ key, status: 'live' });
      })
      .catch(() => {
        if (!stopped) setOutcome({ key, status: 'unavailable' });
      });

    const onVisible = () => {
      if (document.visibilityState === 'visible') setAttempt((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [videoRef, facing, active, supported, key]);

  const status: CameraStatus = !supported ? 'unavailable' : !active ? 'idle' : outcome?.key === key ? outcome.status : 'starting';
  return { status, retry: () => setAttempt((n) => n + 1) };
}

/** The part of a frame that fits the wanted shape, cut from the middle. */
export function centerCrop(width: number, height: number, aspect: number): { x: number; y: number; width: number; height: number } {
  if (width / height > aspect) {
    const cropped = Math.round(height * aspect);
    return { x: Math.round((width - cropped) / 2), y: 0, width: cropped, height };
  }
  const cropped = Math.round(width / aspect);
  return { x: 0, y: Math.round((height - cropped) / 2), width, height: cropped };
}

/**
 * Takes a still from the live picture, cut to the shape shown on screen.
 * With `mirror` the still is flipped left to right, so a selfie is saved the
 * way it looked in the preview.
 */
export function grabFrame(video: HTMLVideoElement, mirror: boolean, aspect = PORTRAIT_ASPECT): Promise<Blob> {
  const crop = centerCrop(video.videoWidth, video.videoHeight, aspect);
  if (crop.width === 0 || crop.height === 0) return Promise.reject(new Error('The camera is not ready yet.'));
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('This browser could not take the photo.'));
  if (mirror) {
    ctx.translate(crop.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('This browser could not take the photo.'))), 'image/jpeg', 0.92);
  });
}

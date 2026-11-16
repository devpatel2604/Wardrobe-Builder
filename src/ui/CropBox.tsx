import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { StoredImage } from './controls';

/** A crop, as shares of the picture's width and height (0 to 1). */
export interface CropShare {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN = 0.12;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

type Grip = 'move' | 'nw' | 'ne' | 'sw' | 'se';

/**
 * A photo with a box to drag over the part to keep. Drag the box to move it,
 * or a corner to resize it.
 */
export function CropBox({
  bytes,
  mimeType,
  onDone,
  onCancel,
  busy,
}: {
  bytes: ArrayBuffer;
  mimeType: string;
  onDone: (crop: CropShare) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [crop, setCrop] = useState<CropShare>({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ grip: Grip; startX: number; startY: number; from: CropShare }>(undefined);

  function begin(grip: Grip, event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { grip, startX: event.clientX, startY: event.clientY, from: crop };
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const state = drag.current;
    const box = frame.current?.getBoundingClientRect();
    if (!state || !box || box.width === 0 || box.height === 0) return;
    const dx = (event.clientX - state.startX) / box.width;
    const dy = (event.clientY - state.startY) / box.height;
    const { from, grip } = state;
    if (grip === 'move') {
      setCrop({ ...from, x: clamp(from.x + dx, 0, 1 - from.width), y: clamp(from.y + dy, 0, 1 - from.height) });
      return;
    }
    let left = from.x;
    let top = from.y;
    let right = from.x + from.width;
    let bottom = from.y + from.height;
    if (grip === 'nw' || grip === 'sw') left = clamp(from.x + dx, 0, right - MIN);
    else right = clamp(right + dx, left + MIN, 1);
    if (grip === 'nw' || grip === 'ne') top = clamp(from.y + dy, 0, bottom - MIN);
    else bottom = clamp(bottom + dy, top + MIN, 1);
    setCrop({ x: left, y: top, width: right - left, height: bottom - top });
  }

  function end() {
    drag.current = undefined;
  }

  const percent = (share: number) => `${share * 100}%`;
  const corners: Grip[] = ['nw', 'ne', 'sw', 'se'];

  return (
    <div className="crop">
      <div className="crop-frame" ref={frame}>
        <StoredImage bytes={bytes} mimeType={mimeType} alt="The photo to crop" className="crop-photo" />
        <div
          className="crop-box"
          style={{ left: percent(crop.x), top: percent(crop.y), width: percent(crop.width), height: percent(crop.height) }}
          onPointerDown={(e) => begin('move', e)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          data-testid="crop-box"
        >
          {corners.map((corner) => (
            <span
              key={corner}
              className={`crop-grip crop-${corner}`}
              onPointerDown={(e) => begin(corner, e)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              data-testid={`crop-${corner}`}
            />
          ))}
        </div>
      </div>
      <p className="hint">Drag the box over the piece. Drag a corner to make it smaller.</p>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDone(crop)}>
          {busy ? 'Cropping' : 'Keep this part'}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

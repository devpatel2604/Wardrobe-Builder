import { useState } from 'react';
import type { SharedLink } from '../../domain/links';
import { useOnline } from '../../ui/useOnline';

/**
 * Shows a saved post. An Instagram post plays in Instagram's own player,
 * inside a frame that Instagram fills. The frame keeps Instagram's code away
 * from the app's data, and the app takes nothing out of it. Instagram can
 * still tell that the post was opened, so the player loads only on a tap
 * once the look has its screenshots.
 */
export function PostPlayer({ shared, startOpen }: { shared: SharedLink; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const online = useOnline();
  const instagram = shared.instagram;

  if (!instagram) {
    return (
      <p>
        <a href={shared.url} target="_blank" rel="noreferrer noopener">
          Open the page on {shared.host}
        </a>
        {shared.host === 'instagram.com' && (
          <span className="hint"> This is a forwarding link, so it cannot play here. To play it in the app, open it, copy the link of the post itself and save that.</span>
        )}
      </p>
    );
  }

  return (
    <>
      {!online ? (
        <p className="hint">You are offline. The post plays here when you are back online.</p>
      ) : open ? (
        <div className="player">
          <iframe
            title="The post, in Instagram's own player"
            src={instagram.embed}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
            allow="encrypted-media; fullscreen; picture-in-picture"
          />
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Play the post here
        </button>
      )}
      <p className="row">
        <a href={shared.url} target="_blank" rel="noreferrer noopener">
          Open in Instagram
        </a>
        {open && online && (
          <button type="button" className="link-btn" onClick={() => setOpen(false)}>
            Hide the player
          </button>
        )}
      </p>
    </>
  );
}

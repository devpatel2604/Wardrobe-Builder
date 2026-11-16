import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deletePiece, getPiece, listPhotos } from '../data/piecesRepo';
import { getProfile } from '../data/profileRepo';
import {
  COLOR_FAMILIES,
  DEPTHS,
  DRESS_LEVELS,
  FITS,
  HARDWARE,
  HEMS,
  NECKLINES,
  SLOTS,
  TEXTURES,
  WARMTHS,
  labelOf,
  swatchOf,
} from '../domain/options';
import { checkPiece } from '../domain/ruleChecks';
import { Card, StoredImage } from '../ui/controls';
import { RuleFindings } from '../ui/RuleFindings';

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function PieceDetailScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const data = useLiveQuery(async () => {
    const [piece, photos, profile] = await Promise.all([getPiece(id), listPhotos(id), getProfile()]);
    return { piece, photos, rules: profile?.rules ?? [] };
  }, [id]);

  if (!data) return <div aria-busy="true" />;
  const { piece, photos, rules } = data;

  if (!piece) {
    return (
      <>
        <Link className="back" to="/wardrobe">
          ‹ Wardrobe
        </Link>
        <p className="empty">That piece is no longer in your wardrobe.</p>
      </>
    );
  }

  const facts: [string, string | undefined][] = [
    ['Worn as', piece.slots.map((s) => labelOf(SLOTS, s)).join(', ')],
    [
      'Color',
      [labelOf(COLOR_FAMILIES, piece.colorFamily), piece.colorName && `"${piece.colorName}"`, labelOf(DEPTHS, piece.depth)?.toLowerCase()]
        .filter(Boolean)
        .join(' · ') || undefined,
    ],
    ['Texture', labelOf(TEXTURES, piece.texture)],
    ['Neckline', labelOf(NECKLINES, piece.neckline)],
    ['Fit', labelOf(FITS, piece.fit)],
    ['Hem ends', labelOf(HEMS, piece.hem)],
    ['Dress level', labelOf(DRESS_LEVELS, piece.dressLevel)],
    ['Cloth', piece.cloth],
    ['Hardware', labelOf(HARDWARE, piece.hardware)],
    ['Warmth', labelOf(WARMTHS, piece.warmth)],
    ['Rain or snow', piece.wetOk === undefined ? undefined : piece.wetOk ? 'Fine when wet' : 'Dry days only'],
    ['Size', piece.size],
    [
      'Price on the page',
      piece.listPrice === undefined ? undefined : `$${piece.listPrice.toFixed(2)}${piece.listPriceOn ? `, seen ${formatDate(piece.listPriceOn)}` : ''}`,
    ],
    ['Price paid', piece.pricePaid === undefined ? undefined : `$${piece.pricePaid.toFixed(2)}`],
    ['Bought', piece.acquiredOn && formatDate(piece.acquiredOn)],
  ];
  const known = facts.filter((f): f is [string, string] => Boolean(f[1]));
  const missing = facts.filter((f) => !f[1]).map((f) => f[0].toLowerCase());
  const swatch = swatchOf(piece.colorFamily);

  return (
    <>
      <div className="detail-top">
        <Link className="back" to="/wardrobe">
          ‹ Wardrobe
        </Link>
        <Link className="btn btn-small" to={`/wardrobe/${piece.id}/edit`}>
          Edit
        </Link>
      </div>

      {photos.length > 0 ? (
        <div className="gallery" aria-label="Photos">
          {photos.map((photo, i) => (
            <StoredImage key={photo.id} bytes={photo.data} mimeType={photo.mimeType} alt={`${piece.name}, photo ${i + 1}`} className="gallery-photo" />
          ))}
        </div>
      ) : (
        <div className="gallery-empty" style={swatch ? { background: swatch } : undefined}>
          <Link className="btn btn-small" to={`/wardrobe/${piece.id}/edit`}>
            Add a photo
          </Link>
        </div>
      )}

      <header className="page-head">
        <div>
          {piece.brand && <p className="eyebrow">{piece.brand}</p>}
          <h1>{piece.name}</h1>
          <p className="piece-tags">
            <span className="tag">{piece.status === 'owned' ? 'You own it' : 'Thinking about it'}</span>
            {!piece.detailsConfirmed && <span className="tag tag-todo">Check details</span>}
          </p>
        </div>
      </header>

      <RuleFindings findings={checkPiece(piece, rules)} />

      {!piece.detailsConfirmed && (
        <p className="notice">
          These details have not been checked against the garment yet.
          {missing.length > 0 && ` Still empty: ${missing.join(', ')}.`}
        </p>
      )}

      <Card title="Details">
        <dl className="facts">
          {known.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {piece.tags.length > 0 && (
          <p className="piece-tags" aria-label="Tags">
            {piece.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </p>
        )}
        {piece.tagging && (
          <p className="muted">
            Tags were first suggested by AI ({piece.tagging.model}) from {piece.tagging.source === 'photo' ? 'a photo' : 'the store page'} on{' '}
            {formatDate(piece.tagging.at.slice(0, 10))}
            {piece.detailsConfirmed ? ', then checked by you.' : '. Not checked yet.'}
          </p>
        )}
      </Card>

      {(piece.notes || piece.link) && (
        <Card title="Notes">
          {piece.notes && <p className="prose">{piece.notes}</p>}
          {piece.link && (
            <p>
              <a href={piece.link} target="_blank" rel="noreferrer noopener">
                Open the product page
              </a>
            </p>
          )}
        </Card>
      )}

      {piece.status === 'owned' && piece.slots.some((s) => s === 'main-top' || s === 'trousers' || s === 'shoes' || s === 'outer-layer') && (
        <Link className="btn" to={`/today?around=${piece.id}`}>
          Build an outfit around this
        </Link>
      )}

      <div className="danger-zone">
        {confirmingDelete ? (
          <>
            <p>Delete this piece and its photos? This cannot be undone.</p>
            <div className="row">
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  await deletePiece(piece.id);
                  navigate('/wardrobe', { replace: true });
                }}
              >
                Yes, delete it
              </button>
              <button type="button" className="btn" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="btn btn-quiet-danger" onClick={() => setConfirmingDelete(true)}>
            Delete this piece
          </button>
        )}
      </div>
    </>
  );
}

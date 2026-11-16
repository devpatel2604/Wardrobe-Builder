import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { countInbox } from '../data/inboxRepo';
import { coverPhotos, listPieces } from '../data/piecesRepo';
import { getProfile } from '../data/profileRepo';
import { SLOTS, labelOf, swatchOf } from '../domain/options';
import { breaksHardRule } from '../domain/ruleChecks';
import type { Photo, Piece, PieceStatus, Rule, Slot } from '../domain/types';
import { PageHeader, StoredImage } from '../ui/controls';
import { ColorTestPrompt } from './colorTest/ColorTestEntry';

interface Group {
  id: string;
  label: string;
  slots: Slot[];
}

export const GROUPS: Group[] = [
  { id: 'tops', label: 'Tops', slots: ['main-top', 'under-layer'] },
  { id: 'trousers', label: 'Trousers', slots: ['trousers'] },
  { id: 'shoes', label: 'Shoes', slots: ['shoes'] },
  { id: 'layers', label: 'Layers and coats', slots: ['outer-layer'] },
  { id: 'accessories', label: 'Accessories', slots: ['belt', 'glasses', 'watch', 'accessory'] },
  { id: 'fragrance', label: 'Fragrance', slots: ['fragrance'] },
];

function inGroup(piece: Piece, group: Group): boolean {
  return piece.slots.some((s) => group.slots.includes(s));
}

export function WardrobeScreen() {
  const data = useLiveQuery(async () => {
    const [pieces, covers, profile, waiting] = await Promise.all([listPieces(), coverPhotos(), getProfile(), countInbox()]);
    return { pieces, covers, rules: profile?.rules ?? [], waiting };
  }, []);
  const [status, setStatus] = useState<PieceStatus>('owned');
  const [groupId, setGroupId] = useState<string>('all');

  if (!data) return <div aria-busy="true" />;

  const owned = data.pieces.filter((p) => p.status === 'owned');
  const considering = data.pieces.filter((p) => p.status === 'considering');
  const inStatus = status === 'owned' ? owned : considering;
  const group = GROUPS.find((g) => g.id === groupId);
  const shown = group ? inStatus.filter((p) => inGroup(p, group)) : inStatus;
  const toCheck = owned.filter((p) => !p.detailsConfirmed).length;

  return (
    <>
      <PageHeader
        eyebrow="Your clothes"
        title="Wardrobe"
        sub={
          owned.length === 0
            ? 'Nothing here yet.'
            : `${owned.length} ${owned.length === 1 ? 'piece' : 'pieces'} you own${toCheck > 0 ? `. ${toCheck} still need their details checked.` : '.'}`
        }
        action={
          <Link className="btn btn-primary btn-small" to="/wardrobe/add">
            Add a piece
          </Link>
        }
      />

      {data.waiting > 0 && (
        <Link className="notice" to="/wardrobe/add">
          {data.waiting === 1 ? '1 thing is waiting to be added' : `${data.waiting} things are waiting to be added`} ›
        </Link>
      )}

      <ColorTestPrompt />

      <div className="segmented" role="group" aria-label="Which pieces">
        <button type="button" aria-pressed={status === 'owned'} onClick={() => setStatus('owned')}>
          Own ({owned.length})
        </button>
        <button type="button" aria-pressed={status === 'considering'} onClick={() => setStatus('considering')}>
          Thinking about ({considering.length})
        </button>
      </div>

      <div className="chips chips-scroll" role="group" aria-label="Filter by kind">
        <button type="button" className={groupId === 'all' ? 'chip chip-on' : 'chip'} aria-pressed={groupId === 'all'} onClick={() => setGroupId('all')}>
          All
        </button>
        {GROUPS.map((g) => {
          const count = inStatus.filter((p) => inGroup(p, g)).length;
          return (
            <button
              key={g.id}
              type="button"
              className={groupId === g.id ? 'chip chip-on' : 'chip'}
              aria-pressed={groupId === g.id}
              onClick={() => setGroupId(g.id)}
            >
              {g.label} ({count})
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="empty">
          {status === 'considering'
            ? 'Nothing here. Add a piece you are thinking about buying to see it against your rules.'
            : group
              ? `No ${group.label.toLowerCase()} yet.`
              : 'Add your first piece with a photo and a few tags.'}
        </p>
      ) : (
        <ul className="grid">
          {shown.map((piece) => (
            <li key={piece.id}>
              <PieceCard piece={piece} cover={data.covers.get(piece.id)} rules={data.rules} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PieceCard({ piece, cover, rules }: { piece: Piece; cover: Photo | undefined; rules: Rule[] }) {
  const swatch = swatchOf(piece.colorFamily);
  const slot = labelOf(SLOTS, piece.slots[0]);
  return (
    <Link className="piece-card" to={`/wardrobe/${piece.id}`}>
      <div className="piece-art" style={!cover && swatch ? { background: swatch } : undefined}>
        {cover ? (
          <StoredImage bytes={cover.thumb} mimeType={cover.mimeType} alt="" className="piece-photo" />
        ) : (
          <span className={swatch ? 'piece-art-label' : 'piece-art-label piece-art-plain'}>No photo yet</span>
        )}
      </div>
      <div className="piece-meta">
        {piece.brand && <p className="piece-brand">{piece.brand}</p>}
        <p className="piece-name">{piece.name}</p>
        <p className="piece-tags">
          {slot && <span className="tag">{slot}</span>}
          {breaksHardRule(piece, rules) && <span className="tag tag-bad">Breaks a rule</span>}
          {!piece.detailsConfirmed && <span className="tag tag-todo">Check details</span>}
        </p>
      </div>
    </Link>
  );
}

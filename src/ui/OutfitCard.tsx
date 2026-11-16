import { SOURCE_LABELS } from '../domain/outfits/formulas';
import type { Candidate, Outfit, Reason } from '../domain/outfits/types';
import { swatchOf } from '../domain/options';
import type { Photo, Piece } from '../domain/types';
import { EvidenceTag, StoredImage } from './controls';

/** The pieces of an outfit from the outside in, each with the word for its place. */
export function outfitRows(outfit: Outfit): [string, Piece][] {
  const rows: [string, Piece | undefined][] = [
    ['Coat', outfit.coat],
    ['Layer', outfit.thirdLayer],
    ['Top', outfit.mainTop],
    ['Under it', outfit.underLayer],
    ['Trousers', outfit.trousers],
    ['Belt', outfit.belt],
    ['Shoes', outfit.shoes],
  ];
  return rows.filter((row): row is [string, Piece] => row[1] !== undefined);
}

function Thumb({ piece, cover }: { piece: Piece; cover: Photo | undefined }) {
  if (cover) return <StoredImage bytes={cover.thumb} mimeType={cover.mimeType} alt="" className="thumb" />;
  return <span className="thumb" style={{ background: swatchOf(piece.colorFamily) }} aria-hidden="true" />;
}

export function OutfitPieces({ outfit, covers }: { outfit: Outfit; covers: Map<string, Photo> }) {
  return (
    <ul className="outfit-rows">
      {outfitRows(outfit).map(([label, piece]) => (
        <li key={`${label}-${piece.id}`} className="outfit-row">
          <Thumb piece={piece} cover={covers.get(piece.id)} />
          <div>
            <p className="outfit-slot">{label}</p>
            <p className="outfit-name">{piece.name}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A row of color dots and the names, for the week view and the alternates. */
export function OutfitLine({ outfit }: { outfit: Outfit }) {
  const rows = outfitRows(outfit);
  return (
    <div className="outfit-line">
      <span className="dots" aria-hidden="true">
        {rows.map(([label, piece]) => (
          <span key={`${label}-${piece.id}`} className="dot dot-big" style={{ background: swatchOf(piece.colorFamily) }} />
        ))}
      </span>
      <p>{rows.map(([, piece]) => piece.name).join(' · ')}</p>
    </div>
  );
}

export function SourceTag({ candidate }: { candidate: Pick<Candidate, 'source' | 'stretch'> }) {
  return <span className={candidate.stretch ? 'tag tag-stretch' : 'tag'}>{SOURCE_LABELS[candidate.source]}</span>;
}

export function ReasonList({ reasons, label }: { reasons: Reason[]; label: string }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="reasons" aria-label={label}>
      {reasons.map((reason) => (
        <li key={reason.text}>
          {reason.text} {reason.evidence && <EvidenceTag evidence={reason.evidence} />}
        </li>
      ))}
    </ul>
  );
}

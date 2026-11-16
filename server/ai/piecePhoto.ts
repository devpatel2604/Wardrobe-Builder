import { PIECE_SCHEMA, NOT_A_PIECE, READER, SHARED_FIELD_GUIDE } from './pieceFields';
import { imageBlocks, type AiKind } from './types';

/**
 * Proposes tags for a piece from a photo of it: a cut-out of the garment,
 * and optionally a second photo of its label.
 */
export const piecePhoto: AiKind = {
  name: 'piece-photo',
  model: 'claude-opus-5-5',
  effort: 'low',
  maxTokens: 6000,
  dailyLimit: 60,
  // Two pictures and a little room.
  maxBodyChars: 3_100_000,
  system: `You read a photo for a private wardrobe app and propose tags for the piece in it. ${READER}

The first photo shows the piece. It is often a cut-out on a plain white background. A second photo, when there is one, shows the piece's care label or brand label.

First decide the subject:
- garment: one piece of clothing, one pair of shoes or one accessory, on its own.
- worn-by-person: someone is wearing it, or a face or a body is in the photo.
- several-items: more than one piece.
- not-clothing: anything else.
${NOT_A_PIECE}

For a garment:
- name: a short plain name he would know it by: the color, the feature that sets it apart, and the type, such as "Burgundy cable-knit crewneck". No brand and no praise.
- brand: only when a brand name is plainly readable on the piece or its label. Otherwise null.
${SHARED_FIELD_GUIDE}
- fit: only for tops and layers, and only when the cut is plain to see, such as clearly boxy and cropped. Otherwise null. Fit depends on the wearer, so list it in unsure whenever you fill it.
- cloth: only from a label photo, copied as printed, such as "100% cotton". With no readable label it is null. A photo of the piece cannot show what it is made of, so never guess.
- colorName, wetOk and price: always null for a photo.

A cut-out or indoor light can shift a color. When two color families are about as likely, pick one and list colorFamily in unsure.`,
  schema: PIECE_SCHEMA,
  buildContent(body) {
    const images = imageBlocks(body.images, 1, 2);
    return [...images, { type: 'text', text: images.length === 2 ? 'Photo 1 is the piece. Photo 2 is its label.' : 'This is the piece.' }];
  },
};

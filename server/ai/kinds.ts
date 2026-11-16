import { leads } from './leads';
import { piecePage } from './piecePage';
import { piecePhoto } from './piecePhoto';
import type { AiKind } from './types';

/**
 * Every kind of AI request the server will pass on. Nothing else gets through.
 * To add one, write its file in this folder and add it to this list.
 */
export const KINDS: AiKind[] = [piecePhoto, piecePage, leads];

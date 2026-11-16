import { describe, expect, it } from 'vitest';
import { sampleRules } from '../test/fixtures';
import { breaksHardRule, checkPiece } from './ruleChecks';

const ids = (findings: ReturnType<typeof checkPiece>) => findings.map((f) => f.id);

describe('checkPiece', () => {
  it('passes an ordinary cotton knit', () => {
    expect(checkPiece({ slots: ['main-top'], cloth: 'Cotton', hardware: 'silver', fit: 'close', hem: 'at-belt' }, sampleRules)).toEqual([]);
  });

  it('blocks leather and suede clothing', () => {
    expect(ids(checkPiece({ slots: ['outer-layer'], cloth: 'Suede' }, sampleRules))).toEqual(['leather-clothing']);
    expect(ids(checkPiece({ slots: ['trousers'], cloth: '100% leather' }, sampleRules))).toEqual(['leather-clothing']);
  });

  it('allows leather and suede shoes and belts', () => {
    expect(checkPiece({ slots: ['shoes'], cloth: 'Suede' }, sampleRules)).toEqual([]);
    expect(checkPiece({ slots: ['belt'], cloth: 'Leather', hardware: 'silver' }, sampleRules)).toEqual([]);
  });

  it('allows a small leather trim on clothing', () => {
    expect(checkPiece({ slots: ['main-top'], cloth: 'Wool with a suede zip pull' }, sampleRules)).toEqual([]);
  });

  it('blocks a leather watch strap but not a steel bracelet', () => {
    expect(ids(checkPiece({ slots: ['watch'], cloth: 'Leather strap' }, sampleRules))).toEqual(['leather-watch-strap']);
    expect(checkPiece({ slots: ['watch'], cloth: 'Steel bracelet', hardware: 'silver' }, sampleRules)).toEqual([]);
  });

  it('blocks gold or brass hardware and only warns on small brass buttons', () => {
    const gold = checkPiece({ slots: ['belt'], hardware: 'gold-or-brass' }, sampleRules);
    expect(gold.map((f) => [f.id, f.severity])).toEqual([['gold-hardware', 'breaks']]);
    const buttons = checkPiece({ slots: ['trousers'], hardware: 'small-brass-buttons' }, sampleRules);
    expect(buttons.map((f) => [f.id, f.severity])).toEqual([['brass-buttons', 'check']]);
  });

  it('blocks boxy tops, and ignores fit on things that are not tops', () => {
    expect(ids(checkPiece({ slots: ['main-top'], fit: 'boxy' }, sampleRules))).toEqual(['boxy']);
    expect(checkPiece({ slots: ['trousers'], fit: 'boxy' }, sampleRules)).toEqual([]);
  });

  it('lets a coat reach mid-thigh but nothing longer', () => {
    expect(checkPiece({ slots: ['outer-layer'], hem: 'mid-thigh' }, sampleRules)).toEqual([]);
    expect(ids(checkPiece({ slots: ['outer-layer'], hem: 'longer' }, sampleRules))).toEqual(['too-long']);
  });

  it('blocks a mid-thigh coat when the coat exception is not in the profile', () => {
    const withoutCoatRule = sampleRules.filter((r) => r.check !== 'coat-to-mid-thigh');
    expect(ids(checkPiece({ slots: ['outer-layer'], hem: 'mid-thigh' }, withoutCoatRule))).toEqual(['too-long']);
  });

  it('blocks a mid-thigh knit and warns on a hem below the fly', () => {
    expect(ids(checkPiece({ slots: ['main-top'], hem: 'mid-thigh' }, sampleRules))).toEqual(['too-long']);
    const below = checkPiece({ slots: ['main-top'], hem: 'below-fly' }, sampleRules);
    expect(below.map((f) => [f.id, f.severity])).toEqual([['hem-below-fly', 'check']]);
  });

  it('runs no check that the profile does not ask for', () => {
    expect(checkPiece({ slots: ['main-top'], cloth: 'Leather', hardware: 'gold-or-brass', fit: 'boxy', hem: 'longer' }, [])).toEqual([]);
  });

  it('labels each finding with the evidence of the rule behind it', () => {
    const [finding] = checkPiece({ slots: ['main-top'], cloth: 'Leather' }, sampleRules);
    expect(finding?.evidence).toBe('your-rule');
  });

  it('breaksHardRule is true only for "breaks" findings', () => {
    expect(breaksHardRule({ slots: ['main-top'], hardware: 'gold-or-brass' }, sampleRules)).toBe(true);
    expect(breaksHardRule({ slots: ['main-top'], hardware: 'small-brass-buttons' }, sampleRules)).toBe(false);
  });
});

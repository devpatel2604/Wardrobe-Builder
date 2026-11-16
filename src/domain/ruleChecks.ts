import { CLOTHING_SLOTS } from './options';
import type { Evidence, Piece, Rule, RuleCheck, Slot } from './types';

/**
 * Checks one piece against the hard rules in the profile. Pure, so it can run
 * on a draft while the form is being filled in.
 *
 * A check runs only when a rule in the profile switches it on (see
 * Rule.check). Delete the rule and the check stops.
 *
 * "breaks" means the piece breaks a hard rule. "check" means it comes close
 * and is worth a look. Nothing here stops a save: the piece may already be
 * owned, and the rules are the owner's to apply.
 */
export interface RuleFinding {
  id:
    | 'leather-clothing'
    | 'leather-watch-strap'
    | 'gold-hardware'
    | 'brass-buttons'
    | 'boxy'
    | 'too-long'
    | 'hem-below-fly';
  severity: 'breaks' | 'check';
  rule: string;
  detail: string;
  evidence: Evidence;
}

type Checkable = Pick<Piece, 'slots' | 'cloth' | 'hardware' | 'fit' | 'hem'>;

const LEATHER = /\b(leather|suede|nubuck|shearling)\b/i;
/** A tiny trim, such as a zip pull, is allowed (design brief, default 9). */
const SMALL_TRIM = /\b(trim|pull|patch|tab|label)\b/i;

function hasAny(slots: Slot[], wanted: Slot[]): boolean {
  return slots.some((s) => wanted.includes(s));
}

export function activeChecks(rules: Rule[]): Map<RuleCheck, Rule> {
  const active = new Map<RuleCheck, Rule>();
  for (const rule of rules) {
    if (rule.check && !active.has(rule.check)) active.set(rule.check, rule);
  }
  return active;
}

export function checkPiece(piece: Checkable, rules: Rule[]): RuleFinding[] {
  const active = activeChecks(rules);
  const findings: RuleFinding[] = [];
  const cloth = piece.cloth ?? '';
  const isLeather = LEATHER.test(cloth) && !SMALL_TRIM.test(cloth);
  const isClothing = hasAny(piece.slots, CLOTHING_SLOTS);
  const isBodyTop = hasAny(piece.slots, ['main-top', 'under-layer']);
  const isOuter = piece.slots.includes('outer-layer');

  const leatherRule = active.get('no-leather-clothing');
  if (leatherRule && isLeather && isClothing) {
    findings.push({
      id: 'leather-clothing',
      severity: 'breaks',
      rule: 'No leather clothing',
      detail: 'Leather and suede are fine for shoes and belts, not for clothes.',
      evidence: leatherRule.evidence,
    });
  }
  if (leatherRule && isLeather && piece.slots.includes('watch')) {
    findings.push({
      id: 'leather-watch-strap',
      severity: 'breaks',
      rule: 'No leather watch straps',
      detail: 'A steel bracelet or a fabric strap fits your rule.',
      evidence: leatherRule.evidence,
    });
  }

  const silverRule = active.get('silver-over-gold');
  if (silverRule && piece.hardware === 'gold-or-brass') {
    findings.push({
      id: 'gold-hardware',
      severity: 'breaks',
      rule: 'Silver over gold',
      detail: 'Gold or brass at the neck, zip or buckle is out. Look for silver, steel or dark hardware.',
      evidence: silverRule.evidence,
    });
  }
  if (silverRule && piece.hardware === 'small-brass-buttons') {
    findings.push({
      id: 'brass-buttons',
      severity: 'check',
      rule: 'Silver over gold',
      detail: 'Small brass buttons are a judgment call. Check how much they show.',
      evidence: 'working-rule',
    });
  }

  const shapeRule = active.get('nothing-boxy-or-long');
  if (shapeRule && (isBodyTop || isOuter)) {
    if (piece.fit === 'boxy') {
      findings.push({
        id: 'boxy',
        severity: 'breaks',
        rule: 'Nothing boxy',
        detail: 'Boxy tops read older on you.',
        evidence: shapeRule.evidence,
      });
    }
    const coatRule = active.get('coat-to-mid-thigh');
    const coatMayReachMidThigh = isOuter && coatRule !== undefined;
    if (piece.hem === 'longer') {
      findings.push({
        id: 'too-long',
        severity: 'breaks',
        rule: 'Nothing long',
        detail: coatRule ? 'A winter coat may reach mid-thigh. Nothing goes longer than that.' : 'Long pieces read older on you.',
        evidence: shapeRule.evidence,
      });
    } else if (piece.hem === 'mid-thigh' && !coatMayReachMidThigh) {
      findings.push({
        id: 'too-long',
        severity: 'breaks',
        rule: 'Nothing long',
        detail: coatRule ? 'Only a winter coat may reach mid-thigh.' : 'Long pieces read older on you.',
        evidence: shapeRule.evidence,
      });
    } else if (piece.hem === 'below-fly' && !isOuter) {
      findings.push({
        id: 'hem-below-fly',
        severity: 'check',
        rule: 'Top hems end between the belt and mid-fly',
        detail: 'A hem below the fly starts to read as a long layer.',
        evidence: 'convention',
      });
    }
  }

  return findings;
}

export function breaksHardRule(piece: Checkable, rules: Rule[]): boolean {
  return checkPiece(piece, rules).some((f) => f.severity === 'breaks');
}

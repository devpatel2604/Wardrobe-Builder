import { describe, expect, it } from 'vitest';
import { fitWithin } from './images';

describe('fitWithin', () => {
  it('leaves a small photo alone', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('shrinks a tall phone photo to the long edge and keeps its shape', () => {
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('shrinks a wide photo', () => {
    expect(fitWithin(4000, 1000, 480)).toEqual({ width: 480, height: 120 });
  });

  it('never returns a zero-sized edge', () => {
    expect(fitWithin(10000, 1, 100)).toEqual({ width: 100, height: 1 });
  });
});

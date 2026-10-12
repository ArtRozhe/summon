import { describe, expect, it } from 'vitest';
import { layoutVariants } from '../../src/layout';

describe('layoutVariants', () => {
  it('reads Latin typed with the Russian layout on', () => {
    expect(layoutVariants('фв1')).toEqual(['фв1', 'ad1']);
    expect(layoutVariants('пеук')).toEqual(['пеук', 'gter']);
  });

  it('reads Russian typed with the English layout on', () => {
    expect(layoutVariants('rjn')).toEqual(['rjn', 'кот']);
  });

  it('maps punctuation keys and keeps case', () => {
    expect(layoutVariants('хъжэбю')[1]).toBe("[];',.");
    expect(layoutVariants('x[];,.')[1]).toBe('чхъжбю');
    // Without letters there is nothing to read in the other layout.
    expect(layoutVariants('[];,.')).toEqual(['[];,.']);
    expect(layoutVariants('ПеУк')[1]).toBe('GtEr');
  });

  it('turns a shifted Ю into ">" (commands)', () => {
    expect(layoutVariants('Ю учзщке')[1]).toBe('> export');
    expect(layoutVariants('юрист')[1]).toBe('.hbcn');
  });

  it('leaves digits-only and symbol-only queries alone', () => {
    expect(layoutVariants('42')).toEqual(['42']);
    expect(layoutVariants('>')).toEqual(['>']);
  });

  it('converts both ways for mixed queries', () => {
    expect(layoutVariants('ad фв')).toEqual(['ad фв', 'ad ad', 'фв фв']);
  });
});

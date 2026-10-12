// Typing with the wrong keyboard layout: "фв1" is "ad1" typed with Russian on, "rjn" is "кот" typed with English on.
// Key positions of the Russian PC layout (ЙЦУКЕН) over US QWERTY. The standard Mac "Russian" layout has the same
// letters in the same places; some punctuation differs, which only matters for the few symbols below.

const RU = 'ёйцукенгшщзхъфывапролджэячсмитьбю';
const EN = '`qwertyuiop[]asdfghjkl;\'zxcvbnm,.';

const toLatin = new Map<string, string>();
const toCyrillic = new Map<string, string>();
for (let i = 0; i < RU.length; i++) {
  toLatin.set(RU[i]!, EN[i]!);
  toCyrillic.set(EN[i]!, RU[i]!);
  // Punctuation has no uppercase: "[" must stay "х", its shifted "{" is "Х" (below).
  if (/[a-z]/.test(EN[i]!)) {
    toLatin.set(RU[i]!.toUpperCase(), EN[i]!.toUpperCase());
    toCyrillic.set(EN[i]!.toUpperCase(), RU[i]!.toUpperCase());
  }
}
// Shifted keys whose uppercase isn't the shifted symbol: Ю is ">" (Shift+.) on the English layout, Б is "<", Ж ":", Э '"'.
for (const [ru, en] of [['Ю', '>'], ['Б', '<'], ['Ж', ':'], ['Э', '"'], ['Х', '{'], ['Ъ', '}'], ['Ё', '~']] as const) {
  toLatin.set(ru, en);
  toCyrillic.set(en, ru);
}

const CYRILLIC = /[а-яё]/i;
const LATIN = /[a-z]/i;

function convert(text: string, map: Map<string, string>): string {
  return [...text].map((c) => map.get(c) ?? c).join('');
}

/**
 * The query as typed, then as it would read in the other layout — for each direction the query has letters in.
 * Mixed queries get both. Returns only distinct variants.
 */
export function layoutVariants(query: string): string[] {
  const variants = [query];
  if (CYRILLIC.test(query)) variants.push(convert(query, toLatin));
  if (LATIN.test(query)) variants.push(convert(query, toCyrillic));
  return [...new Set(variants)];
}

// Map free-text subjects (English, Malayalam, Manglish) to the app's fixed categories.
const RULES = [
  ['childrens', /(child|juvenile|kids|ബാല|kutti|kuttikal|panchatantra|പഞ്ചതന്ത്ര)/i],
  ['drama', /(drama|\bplay(s)?\b|nadakam|natakam|നാടക|attakatha|ആട്ടക്കഥ)/i],
  ['poetry', /(poe(m|try|ms)|kavitha|kavya|കവിത|കാവ്യ|kilippattu|കിളിപ്പാട്ട്|sathakam|ശതക|sandesam|സന്ദേശ|thullal|തുള്ളൽ|തുള്ളല്‍)/i],
  ['short-stories', /(short stor|\bstories\b|katha(kal)?\b|കഥകൾ|കഥകള്‍|ചെറുകഥ)/i],
  ['novels', /(novel|fiction|നോവൽ|നോവല്‍)/i],
  ['religion', /(relig|hindu|christ|islam|bible|quran|qur'an|veda|ramayan|bhagava|gita|purana|mahabharat|ഭക്തി|രാമായണ|ഭാഗവത|ഗീത|വേദ|stotra|സ്തോത്ര|spiritual)/i],
  ['history', /(histor|ചരിത്ര|charithram|charitram|biograph|ജീവചരിത്ര|aitihya|ഐതിഹ്യ|legend)/i],
];

export function guessCategory(text) {
  const t = String(text || '');
  for (const [id, re] of RULES) if (re.test(t)) return id;
  return 'other';
}

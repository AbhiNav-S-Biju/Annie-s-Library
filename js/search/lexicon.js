// @ts-check
// Search dictionary. Used ONLY to expand queries and offer spelling/transliteration suggestions
// ("Did you mean ആടുജീവിതം?"). These are not book records: nothing here is ever shown as a book card
// or claimed to be available; results always come from the real sources.
//
// To improve Manglish search, add entries here. Matching is by phonetic key (see transliteration.js),
// so you only need the correct Malayalam spelling plus one common English spelling.

/**
 * Common words in titles/subjects: Manglish spelling -> Malayalam. Looked up per word by phonetic key,
 * so "aadujeevitham", "adujeevitham" and "aatujivitham" all hit the same entry.
 * @type {Record<string, string>}
 */
export const WORDS = {
  malayalam: 'മലയാളം', kerala: 'കേരള', keralam: 'കേരളം', sree: 'ശ്രീ', sri: 'ശ്രീ',
  ramayanam: 'രാമായണം', ramayana: 'രാമായണ', mahabharatham: 'മഹാഭാരതം', bhagavatham: 'ഭാഗവതം', bhagavad: 'ഭഗവദ്', geetha: 'ഗീത', gita: 'ഗീത',
  katha: 'കഥ', kathakal: 'കഥകൾ', kavitha: 'കവിത', kavithakal: 'കവിതകൾ', novel: 'നോവൽ', nadakam: 'നാടകം', natakam: 'നാടകം',
  charitham: 'ചരിതം', charithram: 'ചരിത്രം', sahithyam: 'സാഹിത്യം', sahitya: 'സാഹിത്യ', kilippattu: 'കിളിപ്പാട്ട്', pattu: 'പാട്ട്',
  sandesam: 'സന്ദേശം', kathakali: 'കഥകളി', aithihyamala: 'ഐതിഹ്യമാല', aitihyamala: 'ഐതിഹ്യമാല',
  oru: 'ഒരു', ente: 'എന്റെ', ninte: 'നിന്റെ', avante: 'അവന്റെ', avalude: 'അവളുടെ', njan: 'ഞാൻ', nee: 'നീ', ini: 'ഇനി',
  desam: 'ദേശം', desathinte: 'ദേശത്തിന്റെ', theruvinte: 'തെരുവിന്റെ', jeevitham: 'ജീവിതം', aadu: 'ആട്', aadujeevitham: 'ആടുജീവിതം',
  kuttikal: 'കുട്ടികൾ', kuttikalude: 'കുട്ടികളുടെ', balasahithyam: 'ബാലസാഹിത്യം', kadha: 'കഥ', kathakalude: 'കഥകളുടെ',
  pranayam: 'പ്രണയം', mazha: 'മഴ', puzha: 'പുഴ', kadal: 'കടൽ', bhoomi: 'ഭൂമി', akasham: 'ആകാശം', nilavu: 'നിലാവ്', veedu: 'വീട്',
  amma: 'അമ്മ', achan: 'അച്ഛൻ', makan: 'മകൻ', makal: 'മകൾ', kaalam: 'കാലം', kalam: 'കാലം', lokam: 'ലോകം', manushyan: 'മനുഷ്യൻ',
  daivam: 'ദൈവം', daivathinte: 'ദൈവത്തിന്റെ', ithihasam: 'ഇതിഹാസം', itihasam: 'ഇതിഹാസം', pusthakam: 'പുസ്തകം', smaranakal: 'സ്മരണകൾ',
  buddha: 'ബുദ്ധ', budha: 'ബുദ്ധ', veena: 'വീണ', poovu: 'പൂവ്', poo: 'പൂ', thamburan: 'തമ്പുരാൻ', thampuran: 'തമ്പുരാൻ', varma: 'വർമ്മ',
  menon: 'മേനോൻ', nair: 'നായർ', pillai: 'പിള്ള', kurup: 'കുറുപ്പ്', namboothiri: 'നമ്പൂതിരി', panicker: 'പണിക്കർ',
  basheer: 'ബഷീർ', vaikom: 'വൈക്കം', muhammad: 'മുഹമ്മദ്', asan: 'ആശാൻ', kumaran: 'കുമാരൻ', vallathol: 'വള്ളത്തോൾ', ulloor: 'ഉള്ളൂർ',
  thakazhi: 'തകഴി', benyamin: 'ബെന്യാമിൻ', ezhuthachan: 'എഴുത്തച്ഛൻ', kunchan: 'കുഞ്ചൻ', nambiar: 'നമ്പ്യാർ',
  mathrubhumi: 'മാതൃഭൂമി', vishnu: 'വിഷ്ണു', krishna: 'കൃഷ്ണ', krishnan: 'കൃഷ്ണൻ', geetham: 'ഗീതം', sangeetham: 'സംഗീതം',
};

/**
 * Well-known works: [Malayalam title, common English spelling, author (ml), author (en)].
 * @type {Array<[string, string, string|null, string|null]>}
 */
const W = [
  ['ആടുജീവിതം', 'Aadujeevitham', 'ബെന്യാമിൻ', 'Benyamin'],
  ['മഞ്ഞവെയിൽ മരണങ്ങൾ', 'Manjaveyil Maranangal', 'ബെന്യാമിൻ', 'Benyamin'],
  ['രണ്ടാമൂഴം', 'Randamoozham', 'എം. ടി. വാസുദേവൻ നായർ', 'M. T. Vasudevan Nair'],
  ['നാലുകെട്ട്', 'Naalukettu', 'എം. ടി. വാസുദേവൻ നായർ', 'M. T. Vasudevan Nair'],
  ['മഞ്ഞ്', 'Manju', 'എം. ടി. വാസുദേവൻ നായർ', 'M. T. Vasudevan Nair'],
  ['കാലം', 'Kaalam', 'എം. ടി. വാസുദേവൻ നായർ', 'M. T. Vasudevan Nair'],
  ['അസുരവിത്ത്', 'Asuravithu', 'എം. ടി. വാസുദേവൻ നായർ', 'M. T. Vasudevan Nair'],
  ['വാനപ്രസ്ഥം', 'Vanaprastham', 'എം. ടി. വാസുദേവൻ നായർ', 'M. T. Vasudevan Nair'],
  ['ചെമ്മീൻ', 'Chemmeen', 'തകഴി ശിവശങ്കരപ്പിള്ള', 'Thakazhi Sivasankara Pillai'],
  ['കയർ', 'Kayar', 'തകഴി ശിവശങ്കരപ്പിള്ള', 'Thakazhi Sivasankara Pillai'],
  ['തോട്ടിയുടെ മകൻ', 'Thottiyude Makan', 'തകഴി ശിവശങ്കരപ്പിള്ള', 'Thakazhi Sivasankara Pillai'],
  ['രണ്ടിടങ്ങഴി', 'Randidangazhi', 'തകഴി ശിവശങ്കരപ്പിള്ള', 'Thakazhi Sivasankara Pillai'],
  ['ഒരു ദേശത്തിന്റെ കഥ', 'Oru Desathinte Katha', 'എസ്. കെ. പൊറ്റെക്കാട്ട്', 'S. K. Pottekkatt'],
  ['ഒരു തെരുവിന്റെ കഥ', 'Oru Theruvinte Katha', 'എസ്. കെ. പൊറ്റെക്കാട്ട്', 'S. K. Pottekkatt'],
  ['വിഷകന്യക', 'Vishakanyaka', 'എസ്. കെ. പൊറ്റെക്കാട്ട്', 'S. K. Pottekkatt'],
  ['ഖസാക്കിന്റെ ഇതിഹാസം', 'Khasakkinte Itihasam', 'ഒ. വി. വിജയൻ', 'O. V. Vijayan'],
  ['ഗുരുസാഗരം', 'Gurusagaram', 'ഒ. വി. വിജയൻ', 'O. V. Vijayan'],
  ['ബാല്യകാലസഖി', 'Balyakalasakhi', 'വൈക്കം മുഹമ്മദ് ബഷീർ', 'Vaikom Muhammad Basheer'],
  ['പാത്തുമ്മയുടെ ആട്', 'Pathummayude Aadu', 'വൈക്കം മുഹമ്മദ് ബഷീർ', 'Vaikom Muhammad Basheer'],
  ['ന്റുപ്പുപ്പാക്കൊരാനേണ്ടാർന്ന്', 'Ntuppuppakkoranendarnnu', 'വൈക്കം മുഹമ്മദ് ബഷീർ', 'Vaikom Muhammad Basheer'],
  ['മതിലുകൾ', 'Mathilukal', 'വൈക്കം മുഹമ്മദ് ബഷീർ', 'Vaikom Muhammad Basheer'],
  ['പ്രേമലേഖനം', 'Premalekhanam', 'വൈക്കം മുഹമ്മദ് ബഷീർ', 'Vaikom Muhammad Basheer'],
  ['ശബ്ദങ്ങൾ', 'Shabdangal', 'വൈക്കം മുഹമ്മദ് ബഷീർ', 'Vaikom Muhammad Basheer'],
  ['ഭൂമിയുടെ അവകാശികൾ', 'Bhoomiyude Avakashikal', 'വൈക്കം മുഹമ്മദ് ബഷീർ', 'Vaikom Muhammad Basheer'],
  ['മയ്യഴിപ്പുഴയുടെ തീരങ്ങളിൽ', 'Mayyazhippuzhayude Theerangalil', 'എം. മുകുന്ദൻ', 'M. Mukundan'],
  ['ദൈവത്തിന്റെ വികൃതികൾ', 'Daivathinte Vikrithikal', 'എം. മുകുന്ദൻ', 'M. Mukundan'],
  ['ആരാച്ചാർ', 'Aarachar', 'കെ. ആർ. മീര', 'K. R. Meera'],
  ['ഇന്ദുലേഖ', 'Indulekha', 'ഒ. ചന്തുമേനോൻ', 'O. Chandu Menon'],
  ['മാർത്താണ്ഡവർമ്മ', 'Marthandavarma', 'സി. വി. രാമൻപിള്ള', 'C. V. Raman Pillai'],
  ['ധർമ്മരാജാ', 'Dharmaraja', 'സി. വി. രാമൻപിള്ള', 'C. V. Raman Pillai'],
  ['രാമരാജാബഹദൂർ', 'Ramarajabahadur', 'സി. വി. രാമൻപിള്ള', 'C. V. Raman Pillai'],
  ['ഐതിഹ്യമാല', 'Aithihyamala', 'കൊട്ടാരത്തിൽ ശങ്കുണ്ണി', 'Kottarathil Sankunni'],
  ['ഉമ്മാച്ചു', 'Ummachu', 'ഉറൂബ്', 'Uroob'],
  ['സുന്ദരികളും സുന്ദരന്മാരും', 'Sundarikalum Sundaranmarum', 'ഉറൂബ്', 'Uroob'],
  ['ഓടയിൽ നിന്ന്', 'Odayil Ninnu', 'പി. കേശവദേവ്', 'P. Kesavadev'],
  ['അഗ്നിസാക്ഷി', 'Agnisakshi', 'ലളിതാംബിക അന്തർജ്ജനം', 'Lalithambika Antharjanam'],
  ['എന്റെ കഥ', 'Ente Katha', 'മാധവിക്കുട്ടി', 'Madhavikutty'],
  ['നീർമാതളം പൂത്ത കാലം', 'Neermathalam Pootha Kaalam', 'മാധവിക്കുട്ടി', 'Madhavikutty'],
  ['ആൾക്കൂട്ടം', 'Aalkkoottam', 'ആനന്ദ്', 'Anand'],
  ['സ്മാരകശിലകൾ', 'Smarakasilakal', 'പുനത്തിൽ കുഞ്ഞബ്ദുള്ള', 'Punathil Kunjabdulla'],
  ['പാണ്ഡവപുരം', 'Pandavapuram', 'സേതു', 'Sethu'],
  ['ആയുസ്സിന്റെ പുസ്തകം', 'Aayussinte Pusthakam', 'സി. വി. ബാലകൃഷ്ണൻ', 'C. V. Balakrishnan'],
  ['ഇനി ഞാൻ ഉറങ്ങട്ടെ', 'Ini Njan Urangatte', 'പി. കെ. ബാലകൃഷ്ണൻ', 'P. K. Balakrishnan'],
  ['ഹിഗ്വിറ്റ', 'Higuita', 'എൻ. എസ്. മാധവൻ', 'N. S. Madhavan'],
  ['ലന്തൻബത്തേരിയിലെ ലുത്തിനിയകൾ', 'Lanthanbatheriyile Luthiniyakal', 'എൻ. എസ്. മാധവൻ', 'N. S. Madhavan'],
  ['മനുഷ്യന് ഒരു ആമുഖം', 'Manushyanu Oru Aamukham', 'സുഭാഷ് ചന്ദ്രൻ', 'Subhash Chandran'],
  ['ഫ്രാൻസിസ് ഇട്ടിക്കോര', 'Francis Itty Cora', 'ടി. ഡി. രാമകൃഷ്ണൻ', 'T. D. Ramakrishnan'],
  ['ഒരു സങ്കീർത്തനം പോലെ', 'Oru Sankeerthanam Pole', 'പെരുമ്പടവം ശ്രീധരൻ', 'Perumbadavam Sreedharan'],
  ['യക്ഷി', 'Yakshi', 'മലയാറ്റൂർ രാമകൃഷ്ണൻ', 'Malayattoor Ramakrishnan'],
  ['മീശ', 'Meesha', 'എസ്. ഹരീഷ്', 'S. Hareesh'],
  ['തട്ടകം', 'Thattakam', 'കോവിലൻ', 'Kovilan'],
  ['നിലം പൂത്തു മലർന്ന നാൾ', 'Nilam Poothu Malarnna Naal', 'മനോജ് കുറൂർ', 'Manoj Kuroor'],
  ['സൂഫി പറഞ്ഞ കഥ', 'Sufi Paranja Katha', 'കെ. പി. രാമനുണ്ണി', 'K. P. Ramanunni'],
  ['വീണപൂവ്', 'Veenapoovu', 'കുമാരനാശാൻ', 'Kumaran Asan'],
  ['നളിനി', 'Nalini', 'കുമാരനാശാൻ', 'Kumaran Asan'],
  ['ലീല', 'Leela', 'കുമാരനാശാൻ', 'Kumaran Asan'],
  ['കരുണ', 'Karuna', 'കുമാരനാശാൻ', 'Kumaran Asan'],
  ['ചിന്താവിഷ്ടയായ സീത', 'Chinthavishtayaya Seetha', 'കുമാരനാശാൻ', 'Kumaran Asan'],
  ['ദുരവസ്ഥ', 'Duravastha', 'കുമാരനാശാൻ', 'Kumaran Asan'],
  ['ചണ്ഡാലഭിക്ഷുകി', 'Chandalabhikshuki', 'കുമാരനാശാൻ', 'Kumaran Asan'],
  ['ശ്രീബുദ്ധചരിതം', 'Sreebuddhacharitham', 'കുമാരനാശാൻ', 'Kumaran Asan'],
  ['രമണൻ', 'Ramanan', 'ചങ്ങമ്പുഴ കൃഷ്ണപിള്ള', 'Changampuzha Krishna Pillai'],
  ['ഓടക്കുഴൽ', 'Odakkuzhal', 'ജി. ശങ്കരക്കുറുപ്പ്', 'G. Sankara Kurup'],
  ['ബന്ധനസ്ഥനായ അനിരുദ്ധൻ', 'Bandhanasthanaya Aniruddhan', 'വള്ളത്തോൾ നാരായണമേനോൻ', 'Vallathol Narayana Menon'],
  ['സാഹിത്യമഞ്ജരി', 'Sahithyamanjari', 'വള്ളത്തോൾ നാരായണമേനോൻ', 'Vallathol Narayana Menon'],
  ['ഉമാകേരളം', 'Umakeralam', 'ഉള്ളൂർ എസ്. പരമേശ്വരയ്യർ', 'Ulloor S. Parameswara Iyer'],
  ['കിരണാവലി', 'Kiranavali', 'ഉള്ളൂർ എസ്. പരമേശ്വരയ്യർ', 'Ulloor S. Parameswara Iyer'],
  ['കേരളസാഹിത്യചരിത്രം', 'Kerala Sahithya Charithram', 'ഉള്ളൂർ എസ്. പരമേശ്വരയ്യർ', 'Ulloor S. Parameswara Iyer'],
  ['ഭൂമിക്കൊരു ചരമഗീതം', 'Bhoomikkoru Charamageetham', 'ഒ. എൻ. വി. കുറുപ്പ്', 'O. N. V. Kurup'],
  ['ഉജ്ജയിനി', 'Ujjayini', 'ഒ. എൻ. വി. കുറുപ്പ്', 'O. N. V. Kurup'],
  ['രാത്രിമഴ', 'Rathrimazha', 'സുഗതകുമാരി', 'Sugathakumari'],
  ['മുത്തശ്ശി', 'Muthassi', 'ബാലാമണിയമ്മ', 'Balamaniamma'],
  ['കുരുക്ഷേത്രം', 'Kurukshethram', 'അയ്യപ്പപ്പണിക്കർ', 'Ayyappa Paniker'],
  ['ഇരുപതാം നൂറ്റാണ്ടിന്റെ ഇതിഹാസം', 'Irupatham Noottandinte Ithihasam', 'അക്കിത്തം', 'Akkitham'],
  ['കണ്ണുനീർത്തുള്ളി', 'Kannuneerthulli', 'നാലപ്പാട്ട് നാരായണമേനോൻ', 'Nalappat Narayana Menon'],
  ['കൃഷ്ണഗാഥ', 'Krishnagatha', 'ചെറുശ്ശേരി', 'Cherusseri'],
  ['ജ്ഞാനപ്പാന', 'Njanappana', 'പൂന്താനം', 'Poonthanam'],
  ['അദ്ധ്യാത്മരാമായണം', 'Adhyathmaramayanam', 'തുഞ്ചത്ത് എഴുത്തച്ഛൻ', 'Thunchath Ezhuthachan'],
  ['മഹാഭാരതം', 'Mahabharatham', 'തുഞ്ചത്ത് എഴുത്തച്ഛൻ', 'Thunchath Ezhuthachan'],
  ['പഞ്ചതന്ത്രം', 'Panchathanthram', 'കുഞ്ചൻ നമ്പ്യാർ', 'Kunchan Nambiar'],
  ['കേരളപാണിനീയം', 'Keralapanineeyam', 'എ. ആർ. രാജരാജവർമ്മ', 'A. R. Raja Raja Varma'],
  ['ശബ്ദശോധിനി', 'Sabdasodhini', 'എ. ആർ. രാജരാജവർമ്മ', 'A. R. Raja Raja Varma'],
  ['കേരളോൽപ്പത്തി', 'Keralolpathi', null, null],
  ['സുഭദ്രാർജ്ജുനം', 'Subhadrarjunam', 'തോട്ടക്കാട്ട് ഇക്കാവമ്മ', 'Thottakkattu Ikkavamma'],
  ['ഗംഗാവതരണം', 'Gangavatharanam', 'കൊടുങ്ങല്ലൂർ കുഞ്ഞിക്കുട്ടൻ തമ്പുരാൻ', 'Kodungallur Kunjikkuttan Thampuran'],
];

/** Extra author spellings people type (short names, initials). [canonical en, ...aliases] */
const AUTHOR_ALIASES = {
  'M. T. Vasudevan Nair': ['MT', 'M T', 'MT Vasudevan Nair'],
  'Vaikom Muhammad Basheer': ['Basheer', 'Bashir'],
  'Kumaran Asan': ['Asan', 'Kumaranasan', 'N. Kumaran Asan'],
  'Thakazhi Sivasankara Pillai': ['Thakazhi'],
  'S. K. Pottekkatt': ['Pottekkatt', 'SK Pottekkad', 'Pottekkad'],
  'O. N. V. Kurup': ['ONV', 'ONV Kurup'],
  'Vallathol Narayana Menon': ['Vallathol'],
  'Ulloor S. Parameswara Iyer': ['Ulloor'],
  'Changampuzha Krishna Pillai': ['Changampuzha'],
  'Thunchath Ezhuthachan': ['Ezhuthachan'],
  'O. Chandu Menon': ['Chandu Menon', 'Chandumenon'],
  'C. V. Raman Pillai': ['CV Raman Pillai', 'C V Raman Pillai'],
  'Madhavikutty': ['Kamala Das', 'Kamala Surayya'],
};

/** Authors not covered by W. */
const EXTRA_AUTHORS = [
  ['സക്കറിയ', 'Zacharia'], ['വി. കെ. എൻ.', 'V. K. N.'], ['കാക്കനാടൻ', 'Kakkanadan'], ['സി. രാധാകൃഷ്ണൻ', 'C. Radhakrishnan'],
  ['എം. പി. നാരായണപിള്ള', 'M. P. Narayana Pillai'], ['വി. ടി. ഭട്ടതിരിപ്പാട്', 'V. T. Bhattathiripad'], ['ഇടശ്ശേരി', 'Edassery'],
  ['വൈലോപ്പിള്ളി ശ്രീധരമേനോൻ', 'Vyloppilli Sreedhara Menon'], ['പി. കുഞ്ഞിരാമൻ നായർ', 'P. Kunhiraman Nair'],
];

/**
 * @typedef {Object} DictEntry
 * @property {'title'|'author'} type
 * @property {string} ml
 * @property {string} en
 * @property {string[]} aliases
 * @property {string} [authorMl]
 * @property {string} [authorEn]
 */

/** @type {DictEntry[]} */
export const DICTIONARY = (() => {
  /** @type {DictEntry[]} */
  const out = [];
  const authors = new Map();
  for (const [ml, en, aMl, aEn] of W) {
    out.push({ type: 'title', ml, en, aliases: [], authorMl: aMl || undefined, authorEn: aEn || undefined });
    if (aMl && aEn && !authors.has(aEn)) authors.set(aEn, aMl);
  }
  for (const [aMl, aEn] of EXTRA_AUTHORS) if (!authors.has(aEn)) authors.set(aEn, aMl);
  for (const [en, ml] of authors) out.push({ type: 'author', ml, en, aliases: AUTHOR_ALIASES[en] || [] });
  return out;
})();

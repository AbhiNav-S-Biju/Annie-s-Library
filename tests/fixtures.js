// TEST FIXTURES ONLY. Shaped like the records the source adapters produce, used to exercise
// merging/ranking without network access. Never loaded by the app.
export const book = (o) => ({ state: 'READ', category: 'other', description: '', ...o });

export const CORPUS = [
  book({ key: 'ia:aadujeevitham-cat', source: 'ia', title: 'Aadujeevitham By Benyamin', author: 'Benyamin', state: 'BUY', year: 2008, category: 'novels' }),
  book({ key: 'ol:/works/OL1W', source: 'openlibrary', title: 'Aatujeevitham', author: 'Benyamin', state: 'BUY', year: 2008 }),
  book({ key: 'gb:abc', source: 'google', title: 'ആടുജീവിതം', author: 'ബെന്യാമിൻ', state: 'PREVIEW', previewLink: 'https://books.google.com/books?id=abc' }),
  book({ key: 'ol:/works/OL2W', source: 'openlibrary', title: 'Manjaveyil maranangal', author: 'Benyamin', state: 'BUY' }),
  book({ key: 'ol:/works/OL3W', source: 'openlibrary', title: 'Randamoozham', author: 'M. T. Vasudevan Nair', state: 'BUY' }),
  book({ key: 'ia:chemmeen', source: 'ia', title: 'ചെമ്മീൻ', author: 'Thakazhi Sivasankara Pillai', state: 'BUY', category: 'novels' }),
  book({ key: 'ia:pathumma', source: 'ia', title: 'പാത്തുമ്മയുടെ ആട്', author: 'Vaikom Muhammad Basheer', state: 'BUY' }),
  book({ key: 'ia:indulekha', source: 'ia', archiveId: 'IndulekhafirstNovelOfMalayalam', title: 'ഇന്ദുലേഖ (Indulekha)', author: 'ഒ. ചന്തുമേനോൻ (O. Chandu Menon)', featured: true, category: 'novels', year: 1889 }),
  book({ key: 'ia:jeevitham', source: 'ia', archiveId: 'jeevitham-x', title: 'Ithanu Nammute Jeevitham', author: 'Someone', description: 'Essays on life' }),
  book({ key: 'ia:gazette', source: 'ia', archiveId: 'gz', title: 'Wild Life Asset / വന്യ ജീവി സമ്പത്ത്', author: 'Kerala Legislative Assembly' }),
];

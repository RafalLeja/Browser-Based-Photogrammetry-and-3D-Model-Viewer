// The museum vocabulary of the app: record fields, licences, note categories and severities, and
// how to cite an object. Labels live here once, so every page says the same thing.
import type { Annotation, CollectionObject, LicenseKey, NoteCategory, RecordField, Severity } from '../api';

export const RECORD_FIELDS: { key: RecordField; label: string; multiline?: boolean; hint?: string }[] = [
  { key: 'accession_number', label: 'Accession number', hint: 'The number in your collection register.' },
  { key: 'maker', label: 'Maker' },
  { key: 'date', label: 'Date', hint: 'Free text, such as “c. 1890” or “2nd century BC”.' },
  { key: 'place', label: 'Place or culture' },
  { key: 'material', label: 'Material and technique' },
  { key: 'credit_line', label: 'Credit line' },
  { key: 'provenance', label: 'Provenance', multiline: true },
];

export const LICENSES: Record<LicenseKey, { label: string; url: string | null; open: boolean }> = {
  cc0: { label: 'CC0 1.0 · Public domain', url: 'https://creativecommons.org/publicdomain/zero/1.0/', open: true },
  'cc-by': { label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', open: true },
  'cc-by-sa': { label: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', open: true },
  'cc-by-nc': { label: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/', open: true },
  'cc-by-nc-nd': { label: 'CC BY-NC-ND 4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/', open: true },
  'all-rights-reserved': { label: 'All rights reserved', url: null, open: false },
};

/** Short badge text: "CC0", "CC BY-NC", "©". */
export function licenseBadge(key: LicenseKey): string {
  if (key === 'all-rights-reserved') return '©';
  return LICENSES[key].label.split(' · ')[0].replace(/ [\d.]+$/, '');
}

export const NOTE_CATEGORIES: { key: NoteCategory; label: string; plural: string }[] = [
  { key: 'note', label: 'Note', plural: 'Notes' },
  { key: 'detail', label: 'Detail', plural: 'Details' },
  { key: 'inscription', label: 'Inscription', plural: 'Inscriptions' },
  { key: 'damage', label: 'Damage', plural: 'Damage' },
  { key: 'repair', label: 'Repair', plural: 'Repairs' },
];

export const categoryLabel = (key: NoteCategory): string => NOTE_CATEGORIES.find((c) => c.key === key)?.label ?? 'Note';

/** The severity scale of museum condition reports, from least to most serious. */
export const SEVERITIES: { key: Severity; label: string }[] = [
  { key: 'negligible', label: 'Negligible' },
  { key: 'slight', label: 'Slight' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'marked', label: 'Marked' },
  { key: 'extreme', label: 'Extreme' },
];

export const severityLabel = (key: Severity | null): string => SEVERITIES.find((s) => s.key === key)?.label ?? '';

type Citable = Pick<CollectionObject, 'id' | 'title' | 'record' | 'created_at'>;

/**
 * A citation in two forms: a sentence in the style of a museum or Chicago reference, and BibTeX.
 * Parts the record does not have are left out rather than guessed.
 */
export function citation(object: Citable, url: string, accessed = new Date()): { text: string; bibtex: string } {
  const { maker, date, accession_number: accession, credit_line: credit } = object.record;
  const day = accessed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const sentence = [maker, `“${object.title}”`, date, credit, accession].filter(Boolean).join(', ');
  const text = `${sentence}. 3D model, Vitrine. ${url} (accessed ${day}).`;

  const year = date?.match(/\d{3,4}/)?.[0] ?? object.created_at.slice(0, 4);
  const escape = (value: string) => value.replace(/([{}\\&%$#_])/g, '\\$1');
  const fields: [string, string | undefined][] = [
    ['title', object.title],
    ['author', maker],
    ['year', year],
    ['note', ['3D model', accession && `accession number ${accession}`, credit].filter(Boolean).join('; ')],
    ['howpublished', `\\url{${url}}`],
    ['urldate', accessed.toISOString().slice(0, 10)],
  ];
  const body = fields
    .filter(([, value]) => value)
    .map(([key, value]) => `  ${key} = {${key === 'howpublished' ? value : escape(value!)}}`)
    .join(',\n');
  return { text, bibtex: `@misc{vitrine-${object.id},\n${body}\n}` };
}

/** What a condition report reads first: damage and repairs, then inscriptions, details and general notes. */
const REPORT_ORDER: NoteCategory[] = ['damage', 'repair', 'inscription', 'detail', 'note'];

/** Notes in report order; damage is sorted by severity, the most severe first. */
export function reportOrder(notes: Annotation[]): Annotation[] {
  const category = (key: NoteCategory) => REPORT_ORDER.indexOf(key);
  const severity = (note: Annotation) => (note.severity ? -SEVERITIES.findIndex((s) => s.key === note.severity) : 0);
  return [...notes].sort((a, b) => category(a.category) - category(b.category) || severity(a) - severity(b) || a.id - b.id);
}

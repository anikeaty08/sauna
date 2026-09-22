export const nameOf = (spec, lang = 'en') => (spec && (lang === 'de' ? (spec.name_de || spec.name_en) : (spec.name_en || spec.name_de))) || '';

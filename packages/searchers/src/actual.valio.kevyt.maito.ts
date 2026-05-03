export const ACTUAL_VALIO_KEVYT_MAITO_QUERY = 'Valio kevyt maito';

export const ACTUAL_VALIO_KEVYT_MAITO_KESKO_STORE = {
  id: 'k-citymarket-lielahti',
  name: 'K-Citymarket Lielahti',
};

export const ACTUAL_VALIO_KEVYT_MAITO_S_GROUP_STORE = {
  id: 'prisma-koivistonkylä',
  name: 'Prisma Koivistonkylä',
};

export function normalizeActualValioKevytMaitoText(value: string | null | undefined) {
  return value
    ?.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim() ?? '';
}

export function looksLikeRequestedValioKevytMaito(candidate: {
  name: string;
  brand?: string | null;
}) {
  const name = normalizeActualValioKevytMaitoText(candidate.name);
  const brand = normalizeActualValioKevytMaitoText(candidate.brand);

  return brand.includes('valio') && name.includes('kevyt') && name.includes('maito');
}

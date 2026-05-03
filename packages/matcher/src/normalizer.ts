import type { CanonicalItem, StoreProductCandidate } from '../../domain/src/index';

export type UnitFamily = 'mass' | 'volume' | 'count';
export type CanonicalUnit = 'g' | 'kg' | 'ml' | 'cl' | 'dl' | 'l' | 'kpl';
export type StandardizedUnit = 'g' | 'ml' | 'kpl';
export type BrandSource = 'explicit' | 'inferred';

export type ParsedPackageSize = {
  matchedText: string;
  packageCount: number;
  quantity: number;
  unit: CanonicalUnit;
  totalQuantity: number;
  family: UnitFamily;
  standardizedUnit: StandardizedUnit;
  standardizedQuantity: number;
  standardizedTotalQuantity: number;
};

export type NormalizedName = {
  original: string;
  normalized: string;
  comparisonText: string;
  brand: string | null;
  brandSource: BrandSource | null;
  parsedSize: ParsedPackageSize | null;
  tokens: string[];
  fingerprint: string;
};

export type NormalizedCanonicalItem = {
  item: CanonicalItem;
  brand: string | null;
  parsedSize: ParsedPackageSize | null;
  names: NormalizedName[];
};

export type NormalizedStoreProductCandidate = {
  candidate: StoreProductCandidate;
  brand: string | null;
  parsedSize: ParsedPackageSize | null;
  name: NormalizedName;
};

export type MatchConfidence = 'high' | 'medium' | 'low';

export type CandidateMatchReason =
  | 'ean'
  | 'brand_size_tokens'
  | 'brand_tokens'
  | 'size_tokens'
  | 'tokens_only'
  | 'ambiguous_top_candidates';

export type CandidatePairScoreBreakdown = {
  eanMatched: boolean;
  brandMatched: boolean;
  sizeMatched: boolean;
  sizeMismatch: boolean;
  overlapTokens: string[];
  missingRequiredTokens: string[];
  leftOnlyTokens: string[];
  rightOnlyTokens: string[];
};

export type CandidatePairScore = {
  score: number;
  reason: CandidateMatchReason;
  breakdown: CandidatePairScoreBreakdown;
};

export type CandidateMatchStatus = 'matched' | 'ambiguous' | 'not_found';

export type CandidateMatch = {
  status: CandidateMatchStatus;
  score: number;
  confidence: number;
  confidenceLabel: MatchConfidence;
  reason: CandidateMatchReason;
  reasoning: string[];
  left: StoreProductCandidate | null;
  right: StoreProductCandidate | null;
  alternatives?: Array<{
    left: StoreProductCandidate;
    right: StoreProductCandidate;
    score: number;
    reason: CandidateMatchReason;
  }>;
};

const STOPWORDS = new Set([
  'x',
  'ja',
  'with',
  'kg',
  'g',
  'mg',
  'l',
  'dl',
  'cl',
  'ml',
  'kpl',
  'pkt',
  'ps',
  'rs',
  'prk',
  'plo',
  'tlk',
  'pack',
  'pakkaus',
]);

const COUNT_ALIASES = ['kpl', 'kpl.', 'kappale', 'kappaletta', 'pcs', 'pc', 'piece', 'pieces'];
const MASS_ALIASES = ['kg', 'kilo', 'kiloa', 'kilogramma', 'kilogrammaa', 'g', 'gr', 'gramma', 'grammaa'];
const VOLUME_ALIASES = [
  'l',
  'ltr',
  'litra',
  'litraa',
  'ml',
  'millilitra',
  'millilitraa',
  'dl',
  'desilitra',
  'desilitraa',
  'cl',
  'senttilitra',
  'senttilitraa',
];

const CANONICAL_UNIT_BY_ALIAS = new Map<string, CanonicalUnit>([
  ...COUNT_ALIASES.map((alias) => [alias, 'kpl'] as const),
  ...MASS_ALIASES.map((alias) => [alias, alias.startsWith('k') ? 'kg' : 'g'] as const),
  ...VOLUME_ALIASES.map((alias) => {
    if (alias.startsWith('m')) {
      return [alias, 'ml'] as const;
    }
    if (alias.startsWith('d')) {
      return [alias, 'dl'] as const;
    }
    if (alias.startsWith('c') || alias.startsWith('s')) {
      return [alias, 'cl'] as const;
    }
    return [alias, 'l'] as const;
  }),
]);

const BRAND_EXCLUSION_TOKENS = new Set([...STOPWORDS, 'iso', 'mini', 'tuore', 'luomu']);

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function foldCharacters(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function applyStandardizations(value: string) {
  return collapseWhitespace(
    value
      .replace(/[×*]/g, ' x ')
      .replace(/&/g, ' ja ')
      .replace(/\b(?:litra|litraa|ltr)\b/gi, ' l ')
      .replace(/\b(?:millilitra|millilitraa)\b/gi, ' ml ')
      .replace(/\b(?:desilitra|desilitraa)\b/gi, ' dl ')
      .replace(/\b(?:senttilitra|senttilitraa)\b/gi, ' cl ')
      .replace(/\b(?:gramma|grammaa|gr)\b/gi, ' g ')
      .replace(/\b(?:kilogramma|kilogrammaa|kilo|kiloa)\b/gi, ' kg ')
      .replace(/\b(?:kappale|kappaletta|pcs|pc|piece|pieces)\b/gi, ' kpl '),
  );
}

export function normalizeText(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  return collapseWhitespace(applyStandardizations(foldCharacters(value).toLowerCase()));
}

export function normalizeUnit(value: string | null | undefined): CanonicalUnit | null {
  const normalized = normalizeText(value).replace(/\.$/, '');
  return CANONICAL_UNIT_BY_ALIAS.get(normalized) ?? null;
}

function getUnitFamily(unit: CanonicalUnit): UnitFamily {
  if (unit === 'kg' || unit === 'g') {
    return 'mass';
  }

  if (unit === 'l' || unit === 'dl' || unit === 'cl' || unit === 'ml') {
    return 'volume';
  }

  return 'count';
}

function toStandardizedQuantity(quantity: number, unit: CanonicalUnit) {
  switch (unit) {
    case 'kg':
      return { standardizedUnit: 'g' as const, standardizedQuantity: quantity * 1000 };
    case 'g':
      return { standardizedUnit: 'g' as const, standardizedQuantity: quantity };
    case 'l':
      return { standardizedUnit: 'ml' as const, standardizedQuantity: quantity * 1000 };
    case 'dl':
      return { standardizedUnit: 'ml' as const, standardizedQuantity: quantity * 100 };
    case 'cl':
      return { standardizedUnit: 'ml' as const, standardizedQuantity: quantity * 10 };
    case 'ml':
      return { standardizedUnit: 'ml' as const, standardizedQuantity: quantity };
    case 'kpl':
      return { standardizedUnit: 'kpl' as const, standardizedQuantity: quantity };
  }
}

function parseNumber(value: string) {
  return Number(value.replace(',', '.'));
}

function createParsedPackageSize(matchedText: string, packageCount: number, quantity: number, unit: CanonicalUnit) {
  const { standardizedUnit, standardizedQuantity } = toStandardizedQuantity(quantity, unit);

  return {
    matchedText: collapseWhitespace(matchedText),
    packageCount,
    quantity,
    unit,
    totalQuantity: quantity * packageCount,
    family: getUnitFamily(unit),
    standardizedUnit,
    standardizedQuantity,
    standardizedTotalQuantity: standardizedQuantity * packageCount,
  } satisfies ParsedPackageSize;
}

export function createPackageSizeFromParts(
  quantity: number | null | undefined,
  unit: string | null | undefined,
  packageCount = 1,
) {
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const normalizedUnit = normalizeUnit(unit);
  if (!normalizedUnit) {
    return null;
  }

  const matchedText = packageCount === 1 ? `${quantity} ${normalizedUnit}` : `${packageCount} x ${quantity} ${normalizedUnit}`;
  return createParsedPackageSize(matchedText, packageCount, quantity, normalizedUnit);
}

export function parsePackageSize(value: string | null | undefined): ParsedPackageSize | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const multiMatch = normalized.match(/(^|\s)(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml|kpl)(?=\s|$)/i);
  if (multiMatch) {
    const packageCount = Number(multiMatch[2]);
    const quantity = parseNumber(multiMatch[3]!);
    const rawUnit = normalizeUnit(multiMatch[4]);

    if (rawUnit) {
      return createParsedPackageSize(multiMatch[0], packageCount, quantity, rawUnit);
    }
  }

  const singleMatch = normalized.match(/(^|\s)(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml|kpl)(?=\s|$)/i);
  if (singleMatch) {
    const quantity = parseNumber(singleMatch[2]!);
    const rawUnit = normalizeUnit(singleMatch[3]);

    if (rawUnit) {
      return createParsedPackageSize(singleMatch[0], 1, quantity, rawUnit);
    }
  }

  return null;
}

function stripPackageSize(normalizedText: string, parsedSize: ParsedPackageSize | null) {
  if (!parsedSize) {
    return normalizedText;
  }

  const quantityPattern = String(parsedSize.quantity).replace('.', '[,.]');
  const unitPattern = parsedSize.unit;
  const packagePattern =
    parsedSize.packageCount > 1
      ? `${parsedSize.packageCount}\\s*x\\s*${quantityPattern}\\s*${unitPattern}`
      : `${quantityPattern}\\s*${unitPattern}`;

  return collapseWhitespace(normalizedText.replace(new RegExp(`(?:^|\\s)${packagePattern}(?=\\s|$)`, 'i'), ' '));
}

function extractTokenSequence(text: string) {
  return text.match(/[\p{L}\p{N}%]+/gu) ?? [];
}

export function inferBrandFromName(name: string | null | undefined) {
  const original = collapseWhitespace(name ?? '');
  if (!original) {
    return null;
  }

  const tokens = original.match(/[\p{L}\p{N}-]+/gu) ?? [];
  if (tokens.length < 2) {
    return null;
  }

  const first = tokens[0]!;
  const normalizedFirst = normalizeText(first);
  if (!normalizedFirst || BRAND_EXCLUSION_TOKENS.has(normalizedFirst)) {
    return null;
  }

  return normalizedFirst;
}

function stripLeadingBrand(normalizedText: string, brand: string | null) {
  if (!brand) {
    return normalizedText;
  }

  const brandTokens = extractTokenSequence(brand);
  if (brandTokens.length === 0) {
    return normalizedText;
  }

  const escaped = brandTokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return collapseWhitespace(normalizedText.replace(new RegExp(`^${escaped}(?=\\s|$)`, 'i'), ' '));
}

export function tokenizeText(value: string | null | undefined) {
  return extractTokenSequence(normalizeText(value)).filter((token) => !STOPWORDS.has(token));
}

export function normalizeName(name: string, explicitBrand?: string | null, explicitSize?: ParsedPackageSize | null): NormalizedName {
  const normalized = normalizeText(name);
  const parsedSize = explicitSize ?? parsePackageSize(normalized);
  const explicitBrandNormalized = normalizeText(explicitBrand);
  const inferredBrand = explicitBrandNormalized ? null : inferBrandFromName(name);
  const brand = explicitBrandNormalized || inferredBrand || null;
  const brandSource = explicitBrandNormalized ? 'explicit' : inferredBrand ? 'inferred' : null;
  const withoutSize = stripPackageSize(normalized, parsedSize);
  const withoutBrand = stripLeadingBrand(withoutSize, brand);
  const tokens = extractTokenSequence(withoutBrand).filter((token) => !STOPWORDS.has(token));

  return {
    original: name,
    normalized,
    comparisonText: withoutBrand,
    brand,
    brandSource,
    parsedSize,
    tokens,
    fingerprint: tokens.join(' '),
  };
}

export function normalizeCanonicalItem(item: CanonicalItem): NormalizedCanonicalItem {
  const parsedSize = createPackageSizeFromParts(item.size ?? null, item.unit ?? null) ?? parsePackageSize(item.name);
  const brand = normalizeText(item.brand) || inferBrandFromName(item.name) || null;
  const names = [item.name, ...item.synonyms, ...item.aliases]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .map((name) => normalizeName(name, brand, parsedSize));

  return {
    item,
    brand,
    parsedSize,
    names,
  };
}

export function normalizeStoreProductCandidate(candidate: StoreProductCandidate): NormalizedStoreProductCandidate {
  const parsedSize = createPackageSizeFromParts(candidate.size ?? null, candidate.unit ?? null) ?? parsePackageSize(candidate.name);
  const brand = normalizeText(candidate.brand) || inferBrandFromName(candidate.name) || null;

  return {
    candidate,
    brand,
    parsedSize,
    name: normalizeName(candidate.name, brand, parsedSize),
  };
}

function compactComparableText(value: string) {
  return value.replace(/\s+/g, '');
}

function intersectTokens(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((token, index) => rightSet.has(token) && left.indexOf(token) === index);
}

function tokensEquivalent(left: string[], right: string[]) {
  const leftJoined = left.join('');
  const rightJoined = right.join('');

  if (!leftJoined || !rightJoined) {
    return false;
  }

  return leftJoined === rightJoined;
}

function differenceTokens(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((token, index) => !rightSet.has(token) && left.indexOf(token) === index);
}

function hasMatchingParsedSize(
  left: ParsedPackageSize | null,
  right: ParsedPackageSize | null,
) {
  if (!left || !right) {
    return false;
  }

  return (
    left.standardizedUnit === right.standardizedUnit &&
    left.standardizedTotalQuantity === right.standardizedTotalQuantity
  );
}

function hasMismatchingSizeFamily(
  left: ParsedPackageSize | null,
  right: ParsedPackageSize | null,
) {
  if (!left || !right) {
    return false;
  }

  if (left.standardizedUnit !== right.standardizedUnit) {
    return true;
  }

  return left.standardizedTotalQuantity !== right.standardizedTotalQuantity;
}

function scoreCandidatePair(
  leftCandidate: StoreProductCandidate,
  rightCandidate: StoreProductCandidate,
): CandidatePairScore {
  const left = normalizeStoreProductCandidate(leftCandidate);
  const right = normalizeStoreProductCandidate(rightCandidate);
  const leftEan = normalizeText(leftCandidate.ean);
  const rightEan = normalizeText(rightCandidate.ean);

  if (leftEan && rightEan && leftEan === rightEan) {
    return {
      score: 100,
      reason: 'ean',
      breakdown: {
        eanMatched: true,
        brandMatched: (left.brand ?? null) === (right.brand ?? null),
        sizeMatched: hasMatchingParsedSize(left.parsedSize, right.parsedSize),
        sizeMismatch: hasMismatchingSizeFamily(left.parsedSize, right.parsedSize),
        overlapTokens: intersectTokens(left.name.tokens, right.name.tokens),
        missingRequiredTokens: [],
        leftOnlyTokens: differenceTokens(left.name.tokens, right.name.tokens),
        rightOnlyTokens: differenceTokens(right.name.tokens, left.name.tokens),
      },
    };
  }

  const equivalentTokens = tokensEquivalent(left.name.tokens, right.name.tokens);
  const overlapTokens = equivalentTokens
    ? Array.from(new Set([...left.name.tokens, ...right.name.tokens]))
    : intersectTokens(left.name.tokens, right.name.tokens);
  const leftOnlyTokens = equivalentTokens ? [] : differenceTokens(left.name.tokens, right.name.tokens);
  const rightOnlyTokens = equivalentTokens ? [] : differenceTokens(right.name.tokens, left.name.tokens);
  const missingRequiredTokens = [...leftOnlyTokens, ...rightOnlyTokens];
  const brandMatched = Boolean(left.brand && right.brand && left.brand === right.brand);
  const sizeMatched = hasMatchingParsedSize(left.parsedSize, right.parsedSize);
  const sizeMismatch = hasMismatchingSizeFamily(left.parsedSize, right.parsedSize);

  let score = 0;

  if (brandMatched) {
    score += 40;
  }

  if (sizeMatched) {
    score += 30;
  } else if (sizeMismatch) {
    score -= 30;
  }

  score += Math.min(20, Math.max(1, overlapTokens.length) * 10);
  score -= Math.min(25, missingRequiredTokens.length * 10);

  let reason: CandidateMatchReason = 'tokens_only';
  if (brandMatched && sizeMatched && overlapTokens.length > 0) {
    reason = 'brand_size_tokens';
  } else if (brandMatched && overlapTokens.length > 0) {
    reason = 'brand_tokens';
  } else if (sizeMatched && overlapTokens.length > 0) {
    reason = 'size_tokens';
  }

  return {
    score,
    reason,
    breakdown: {
      eanMatched: false,
      brandMatched,
      sizeMatched,
      sizeMismatch,
      overlapTokens,
      missingRequiredTokens,
      leftOnlyTokens,
      rightOnlyTokens,
    },
  };
}

function toConfidence(score: number) {
  if (score >= 90) {
    return { confidence: 1, confidenceLabel: 'high' as const };
  }

  if (score >= 70) {
    return { confidence: 0.92, confidenceLabel: 'high' as const };
  }

  if (score >= 50) {
    return { confidence: 0.72, confidenceLabel: 'medium' as const };
  }

  if (score >= 30) {
    return { confidence: 0.45, confidenceLabel: 'low' as const };
  }

  return { confidence: 0, confidenceLabel: 'low' as const };
}

function buildReasoning(score: CandidatePairScore) {
  const reasons: string[] = [];

  if (score.breakdown.eanMatched) {
    reasons.push('EAN matched exactly');
  }
  if (score.breakdown.brandMatched) {
    reasons.push('brand matched');
  }
  if (score.breakdown.sizeMatched) {
    reasons.push('package size matched');
  }
  if (score.breakdown.overlapTokens.length > 0) {
    reasons.push(`shared tokens: ${score.breakdown.overlapTokens.join(', ')}`);
  }
  if (score.breakdown.missingRequiredTokens.length > 0) {
    reasons.push(`token mismatch: ${score.breakdown.missingRequiredTokens.join(', ')}`);
  }
  if (score.breakdown.sizeMismatch) {
    reasons.push('package size mismatch');
  }

  return reasons;
}

export function createStoreProductFallbackKey(candidate: StoreProductCandidate) {
  const normalized = normalizeStoreProductCandidate(candidate);
  const brand = normalized.brand ?? 'unknown';
  const name = normalizeText(candidate.name) || compactComparableText(normalized.name.comparisonText) || 'unknown';

  return `${brand}|${name}`;
}

export function createStoreProductKey(candidate: StoreProductCandidate) {
  return normalizeText(candidate.ean) || normalizeText(candidate.key) || createStoreProductFallbackKey(candidate);
}

export function findBestCandidateMatch(
  leftCandidates: StoreProductCandidate[],
  rightCandidates: StoreProductCandidate[],
): CandidateMatch {
  if (leftCandidates.length === 0 || rightCandidates.length === 0) {
    return {
      status: 'not_found',
      score: 0,
      confidence: 0,
      confidenceLabel: 'low',
      reason: 'tokens_only',
      reasoning: ['no candidates available'],
      left: null,
      right: null,
    };
  }

  const scoredPairs = leftCandidates.flatMap((left) =>
    rightCandidates.map((right) => ({ left, right, scored: scoreCandidatePair(left, right) })),
  );

  scoredPairs.sort((a, b) => b.scored.score - a.scored.score);

  const best = scoredPairs[0];
  if (!best || best.scored.score < 50) {
    return {
      status: 'not_found',
      score: best?.scored.score ?? 0,
      confidence: 0,
      confidenceLabel: 'low',
      reason: best?.scored.reason ?? 'tokens_only',
      reasoning: best ? buildReasoning(best.scored) : ['no viable candidate pairs'],
      left: null,
      right: null,
    };
  }

  const second = scoredPairs[1];
  const ambiguous =
    !!second &&
    (best.scored.score - second.scored.score < 10 ||
      (best.scored.breakdown.brandMatched === second.scored.breakdown.brandMatched &&
        best.scored.breakdown.overlapTokens.join('|') === second.scored.breakdown.overlapTokens.join('|') &&
        best.scored.breakdown.sizeMatched !== second.scored.breakdown.sizeMatched));
  const { confidence, confidenceLabel } = toConfidence(best.scored.score);

  if (ambiguous) {
    return {
      status: 'ambiguous',
      score: best.scored.score,
      confidence: Math.min(confidence, 0.6),
      confidenceLabel: 'medium',
      reason: 'ambiguous_top_candidates',
      reasoning: [
        ...buildReasoning(best.scored),
        `top two candidate pairs were within ${best.scored.score - second.scored.score} points`,
      ],
      left: best.left,
      right: best.right,
      alternatives: [best, second].map((entry) => ({
        left: entry.left,
        right: entry.right,
        score: entry.scored.score,
        reason: entry.scored.reason,
      })),
    };
  }

  return {
    status: 'matched',
    score: best.scored.score,
    confidence,
    confidenceLabel,
    reason: best.scored.reason,
    reasoning: buildReasoning(best.scored),
    left: best.left,
    right: best.right,
  };
}

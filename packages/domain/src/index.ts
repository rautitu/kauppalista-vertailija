import { z } from 'zod';

export const ServiceStateSchema = z.enum(['ok', 'error']);
export type ServiceState = z.infer<typeof ServiceStateSchema>;

export const HealthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  services: z.object({
    api: ServiceStateSchema,
    database: ServiceStateSchema,
  }),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const StoreSourceSchema = z.enum(['k-ruoka', 's-kaupat']);
export type StoreSource = z.infer<typeof StoreSourceSchema>;

export const MatchStatusSchema = z.enum(['matched', 'ambiguous', 'not_found']);
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

const NonEmptyStringSchema = z.string().trim().min(1);
const OptionalTextSchema = z.string().trim().min(1).nullable().optional();
const OptionalPositiveNumberSchema = z.number().positive().nullable().optional();
const MoneySchema = z.number().nonnegative();

export const SearchScoreBreakdownSchema = z.object({
  normalizedQuery: z.string(),
  queryTokens: z.array(z.string()),
  candidateTokens: z.array(z.string()),
  matchedTokens: z.array(z.string()),
  missingTokens: z.array(z.string()),
  brandMatched: z.boolean(),
  sizeMatched: z.boolean(),
  exactNameMatch: z.boolean(),
});
export type SearchScoreBreakdown = z.infer<typeof SearchScoreBreakdownSchema>;

export const CanonicalItemSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  brand: OptionalTextSchema,
  manufacturer: OptionalTextSchema,
  size: OptionalPositiveNumberSchema,
  unit: OptionalTextSchema,
  category: OptionalTextSchema,
  synonyms: z.array(NonEmptyStringSchema).default([]),
  aliases: z.array(NonEmptyStringSchema).default([]),
});
export type CanonicalItem = z.infer<typeof CanonicalItemSchema>;

export const StoreSchema = z.object({
  source: StoreSourceSchema,
  storeId: NonEmptyStringSchema,
  storeName: NonEmptyStringSchema,
  city: OptionalTextSchema,
  address: OptionalTextSchema,
});
export type Store = z.infer<typeof StoreSchema>;

export const StoreProductCandidateSchema = z.object({
  source: StoreSourceSchema,
  storeId: NonEmptyStringSchema,
  productId: NonEmptyStringSchema,
  key: NonEmptyStringSchema,
  ean: OptionalTextSchema,
  name: NonEmptyStringSchema,
  brand: OptionalTextSchema,
  size: OptionalPositiveNumberSchema,
  unit: OptionalTextSchema,
  price: MoneySchema,
  comparisonPrice: MoneySchema.nullable().optional(),
  searchScore: z.number().default(0),
  searchScoreBreakdown: SearchScoreBreakdownSchema.optional(),
  rawPayload: z.unknown(),
});
export type StoreProductCandidate = z.infer<typeof StoreProductCandidateSchema>;

export const ProductMatchSchema = z.object({
  canonicalItemId: NonEmptyStringSchema,
  source: StoreSourceSchema,
  storeId: NonEmptyStringSchema,
  storeProductId: NonEmptyStringSchema,
  score: z.number(),
  confidence: z.number().min(0).max(1),
  status: MatchStatusSchema,
  candidate: StoreProductCandidateSchema.optional(),
  reason: OptionalTextSchema,
});
export type ProductMatch = z.infer<typeof ProductMatchSchema>;

export const ComparisonRunItemSchema = z.object({
  canonicalItem: CanonicalItemSchema,
  kMatch: ProductMatchSchema.nullable(),
  sMatch: ProductMatchSchema.nullable(),
  status: MatchStatusSchema,
});
export type ComparisonRunItem = z.infer<typeof ComparisonRunItemSchema>;

export const ComparisonRunTotalsSchema = z.object({
  kTotal: MoneySchema,
  sTotal: MoneySchema,
  difference: z.number(),
  matchedItems: z.number().int().nonnegative(),
  ambiguousItems: z.number().int().nonnegative(),
  missingItems: z.number().int().nonnegative(),
});
export type ComparisonRunTotals = z.infer<typeof ComparisonRunTotalsSchema>;

export const ComparisonRunSchema = z.object({
  id: NonEmptyStringSchema,
  selectedKStore: StoreSchema.refine((store) => store.source === 'k-ruoka', {
    message: 'selectedKStore must use source k-ruoka',
  }),
  selectedSStore: StoreSchema.refine((store) => store.source === 's-kaupat', {
    message: 'selectedSStore must use source s-kaupat',
  }),
  inputShoppingList: z.array(CanonicalItemSchema),
  matchedRows: z.array(ComparisonRunItemSchema),
  totals: ComparisonRunTotalsSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ComparisonRun = z.infer<typeof ComparisonRunSchema>;

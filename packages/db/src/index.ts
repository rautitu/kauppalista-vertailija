import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Pool, type PoolClient, type QueryResultRow } from 'pg';

const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://kauppalista:kauppalista@localhost:51110/kauppalista';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, '../migrations');
const seedsDir = path.resolve(moduleDir, '../seeds');

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'> | Pick<Client, 'query'>;

export type DatabaseConnectionOptions = {
  connectionString?: string;
  schema?: string;
};

export type CanonicalItemRecord = {
  id: string;
  name: string;
  brand?: string | null;
  manufacturer?: string | null;
  size?: number | null;
  unit?: string | null;
  category?: string | null;
  metadata?: Record<string, unknown>;
};

export type CanonicalItemWithAliases = CanonicalItemRecord & {
  aliases: Array<{
    id: string;
    alias: string;
    aliasType: string;
  }>;
};

export type ComparisonRunRecord = {
  id: string;
  selectedKStoreId: string;
  selectedSStoreId: string;
  inputShoppingList: unknown[];
  totals: Record<string, unknown>;
};

export type ComparisonRunItemRecord = {
  comparisonRunId: string;
  canonicalItemId: string;
  inputItem: Record<string, unknown>;
  status: 'matched' | 'ambiguous' | 'not_found';
  rowOrder?: number;
  kMatchId?: string | null;
  sMatchId?: string | null;
  priceDifference?: number | null;
  notes?: string | null;
};

export type SearchLogRecord = {
  comparisonRunId?: string | null;
  canonicalItemId?: string | null;
  source: 'k-ruoka' | 's-kaupat';
  storeId?: string | null;
  query: string;
  candidateCount?: number;
  requestPayload?: unknown;
  responsePayload?: unknown;
};

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function getDatabaseConfig(options: DatabaseConnectionOptions = {}) {
  return {
    connectionString: options.connectionString ?? DEFAULT_DATABASE_URL,
    schema: options.schema ?? 'public',
  };
}

async function ensureSchema(queryable: Queryable, schema: string) {
  const quotedSchema = quoteIdentifier(schema);
  await queryable.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
  await queryable.query(`SET search_path TO ${quotedSchema}, public`);
}

async function ensureMigrationsTable(queryable: Queryable, schema: string) {
  const quotedSchema = quoteIdentifier(schema);
  await queryable.query(`
    CREATE TABLE IF NOT EXISTS ${quotedSchema}._migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listSqlFiles(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

async function runSqlFiles(queryable: Queryable, directory: string) {
  const filenames = await listSqlFiles(directory);

  for (const filename of filenames) {
    const sql = await readFile(path.join(directory, filename), 'utf8');
    await queryable.query(sql);
  }
}

export async function runMigrations(options: DatabaseConnectionOptions = {}) {
  const { connectionString, schema } = getDatabaseConfig(options);
  const client = new Client({ connectionString });

  try {
    await client.connect();
    await ensureSchema(client, schema);
    await ensureMigrationsTable(client, schema);

    const filenames = await listSqlFiles(migrationsDir);

    for (const filename of filenames) {
      const alreadyApplied = await client.query<{ name: string }>(
        'SELECT name FROM _migrations WHERE name = $1',
        [filename],
      );

      if (alreadyApplied.rowCount) {
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [filename]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function runSeeds(options: DatabaseConnectionOptions = {}) {
  const { connectionString, schema } = getDatabaseConfig(options);
  const client = new Client({ connectionString });

  try {
    await client.connect();
    await ensureSchema(client, schema);
    await runSqlFiles(client, seedsDir);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function checkDatabaseHealth() {
  const { connectionString } = getDatabaseConfig();
  const client = new Client({ connectionString });

  try {
    await client.connect();
    await client.query('select 1');
    return { ok: true as const };
  } catch (error) {
    console.error('Database healthcheck failed', error);
    return { ok: false as const };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function createDatabase(options: DatabaseConnectionOptions = {}) {
  const { connectionString, schema } = getDatabaseConfig(options);
  const pool = new Pool({ connectionString });

  async function withClient<T>(callback: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await ensureSchema(client, schema);
      return await callback(client);
    } finally {
      client.release();
    }
  }

  return {
    close: async () => {
      await pool.end();
    },

    createCanonicalItem: (record: CanonicalItemRecord) =>
      withClient(async (client) => {
        const result = await client.query<CanonicalItemRecord>(
          `
            INSERT INTO canonical_items (id, name, brand, manufacturer, size, unit, category, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            RETURNING id, name, brand, manufacturer, size::float8 AS size, unit, category, metadata
          `,
          [
            record.id,
            record.name,
            record.brand ?? null,
            record.manufacturer ?? null,
            record.size ?? null,
            record.unit ?? null,
            record.category ?? null,
            JSON.stringify(record.metadata ?? {}),
          ],
        );

        return result.rows[0];
      }),

    addCanonicalItemAlias: (canonicalItemId: string, alias: string, aliasType = 'search') =>
      withClient(async (client) => {
        const result = await client.query<{ id: string; alias: string; alias_type: string }>(
          `
            INSERT INTO canonical_item_aliases (canonical_item_id, alias, alias_type)
            VALUES ($1, $2, $3)
            ON CONFLICT (canonical_item_id, alias)
            DO UPDATE SET alias_type = EXCLUDED.alias_type
            RETURNING id, alias, alias_type
          `,
          [canonicalItemId, alias, aliasType],
        );

        return {
          id: result.rows[0].id,
          alias: result.rows[0].alias,
          aliasType: result.rows[0].alias_type,
        };
      }),

    getCanonicalItemWithAliases: (id: string) =>
      withClient(async (client) => {
        const itemResult = await client.query<CanonicalItemRecord>(
          `
            SELECT id, name, brand, manufacturer, size::float8 AS size, unit, category, metadata
            FROM canonical_items
            WHERE id = $1
          `,
          [id],
        );

        if (!itemResult.rows[0]) {
          return null;
        }

        const aliasesResult = await client.query<{ id: string; alias: string; alias_type: string }>(
          `
            SELECT id, alias, alias_type
            FROM canonical_item_aliases
            WHERE canonical_item_id = $1
            ORDER BY alias ASC
          `,
          [id],
        );

        return {
          ...itemResult.rows[0],
          aliases: aliasesResult.rows.map((row) => ({
            id: row.id,
            alias: row.alias,
            aliasType: row.alias_type,
          })),
        } satisfies CanonicalItemWithAliases;
      }),

    createStoreProductMatch: (input: {
      canonicalItemId: string;
      storeId: string;
      storeProductId: string;
      productName: string;
      brand?: string | null;
      size?: number | null;
      unit?: string | null;
      price: number;
      comparisonPrice?: number | null;
      score: number;
      confidence: number;
      status: 'matched' | 'ambiguous' | 'not_found';
      rawPayload?: unknown;
    }) =>
      withClient(async (client) => {
        const result = await client.query<{ id: string }>(
          `
            INSERT INTO store_product_matches (
              canonical_item_id,
              store_id,
              store_product_id,
              product_name,
              brand,
              size,
              unit,
              price,
              comparison_price,
              score,
              confidence,
              status,
              raw_payload
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
            RETURNING id
          `,
          [
            input.canonicalItemId,
            input.storeId,
            input.storeProductId,
            input.productName,
            input.brand ?? null,
            input.size ?? null,
            input.unit ?? null,
            input.price,
            input.comparisonPrice ?? null,
            input.score,
            input.confidence,
            input.status,
            JSON.stringify(input.rawPayload ?? {}),
          ],
        );

        return result.rows[0].id;
      }),

    createComparisonRun: (record: ComparisonRunRecord) =>
      withClient(async (client) => {
        const result = await client.query<{ id: string }>(
          `
            INSERT INTO comparison_runs (id, selected_k_store_id, selected_s_store_id, input_shopping_list, totals)
            VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
            RETURNING id
          `,
          [
            record.id,
            record.selectedKStoreId,
            record.selectedSStoreId,
            JSON.stringify(record.inputShoppingList),
            JSON.stringify(record.totals),
          ],
        );

        return result.rows[0].id;
      }),

    addComparisonRunItem: (record: ComparisonRunItemRecord) =>
      withClient(async (client) => {
        const result = await client.query<{ id: string }>(
          `
            INSERT INTO comparison_run_items (
              comparison_run_id,
              canonical_item_id,
              input_item,
              k_match_id,
              s_match_id,
              status,
              price_difference,
              notes,
              row_order
            )
            VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
            RETURNING id
          `,
          [
            record.comparisonRunId,
            record.canonicalItemId,
            JSON.stringify(record.inputItem),
            record.kMatchId ?? null,
            record.sMatchId ?? null,
            record.status,
            record.priceDifference ?? null,
            record.notes ?? null,
            record.rowOrder ?? 0,
          ],
        );

        return result.rows[0].id;
      }),

    createSearchLog: (record: SearchLogRecord) =>
      withClient(async (client) => {
        const result = await client.query<{ id: string }>(
          `
            INSERT INTO search_logs (
              comparison_run_id,
              canonical_item_id,
              source,
              store_id,
              query,
              candidate_count,
              request_payload,
              response_payload
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
            RETURNING id
          `,
          [
            record.comparisonRunId ?? null,
            record.canonicalItemId ?? null,
            record.source,
            record.storeId ?? null,
            record.query,
            record.candidateCount ?? 0,
            JSON.stringify(record.requestPayload ?? null),
            JSON.stringify(record.responsePayload ?? null),
          ],
        );

        return result.rows[0].id;
      }),

    getComparisonRunWithItems: (id: string) =>
      withClient(async (client) => {
        const runResult = await client.query<{
          id: string;
          selected_k_store_id: string;
          selected_s_store_id: string;
          input_shopping_list: unknown[];
          totals: Record<string, unknown>;
        }>(
          `
            SELECT id, selected_k_store_id, selected_s_store_id, input_shopping_list, totals
            FROM comparison_runs
            WHERE id = $1
          `,
          [id],
        );

        if (!runResult.rows[0]) {
          return null;
        }

        const itemsResult = await client.query<{
          id: string;
          canonical_item_id: string;
          input_item: Record<string, unknown>;
          status: string;
          row_order: number;
          k_match_id: string | null;
          s_match_id: string | null;
          price_difference: string | null;
          notes: string | null;
        }>(
          `
            SELECT id, canonical_item_id, input_item, status, row_order, k_match_id, s_match_id, price_difference, notes
            FROM comparison_run_items
            WHERE comparison_run_id = $1
            ORDER BY row_order ASC, created_at ASC
          `,
          [id],
        );

        const logsResult = await client.query<{
          id: string;
          source: 'k-ruoka' | 's-kaupat';
          query: string;
          candidate_count: number;
        }>(
          `
            SELECT id, source, query, candidate_count
            FROM search_logs
            WHERE comparison_run_id = $1
            ORDER BY created_at ASC
          `,
          [id],
        );

        return {
          id: runResult.rows[0].id,
          selectedKStoreId: runResult.rows[0].selected_k_store_id,
          selectedSStoreId: runResult.rows[0].selected_s_store_id,
          inputShoppingList: runResult.rows[0].input_shopping_list,
          totals: runResult.rows[0].totals,
          items: itemsResult.rows.map((row) => ({
            id: row.id,
            canonicalItemId: row.canonical_item_id,
            inputItem: row.input_item,
            status: row.status,
            rowOrder: row.row_order,
            kMatchId: row.k_match_id,
            sMatchId: row.s_match_id,
            priceDifference: row.price_difference === null ? null : Number(row.price_difference),
            notes: row.notes,
          })),
          logs: logsResult.rows.map((row) => ({
            id: row.id,
            source: row.source,
            query: row.query,
            candidateCount: row.candidate_count,
          })),
        };
      }),

    query: <T extends QueryResultRow>(text: string, params?: unknown[]) =>
      withClient((client) => client.query<T>(text, params)),
  };
}

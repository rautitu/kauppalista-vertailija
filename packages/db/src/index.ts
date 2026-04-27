import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://kauppalista:kauppalista@localhost:51110/kauppalista';

export async function checkDatabaseHealth() {
  const client = new Client({ connectionString: databaseUrl });

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

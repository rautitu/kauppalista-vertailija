import { runMigrations, runSeeds } from './index';

const command = process.argv[2];
const schema = process.env.DB_SCHEMA;

if (command === 'migrate') {
  await runMigrations({ schema });
  console.log(`Migrations applied${schema ? ` for schema ${schema}` : ''}.`);
} else if (command === 'seed') {
  // Test/dev only: this seed path is not intended for production builds or deployment pipelines.
  await runSeeds({ schema });
  console.log(`Seed data applied${schema ? ` for schema ${schema}` : ''}.`);
} else {
  console.error('Usage: bun src/cli.ts <migrate|seed>');
  process.exit(1);
}

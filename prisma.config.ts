import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Prisma 7: the CLI (migrate / db seed / generate) takes its datasource, schema
// and seed setup from here — the datasource `url` in schema.prisma is gone.
// The runtime client connects through the pg driver adapter in
// src/lib/prisma.ts; both read DATABASE_URL from the environment (dotenv
// loads a local .env, a no-op on Railway; quiet: dotenv 17 otherwise logs
// on every `prisma migrate deploy` boot).
loadEnv({ quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});

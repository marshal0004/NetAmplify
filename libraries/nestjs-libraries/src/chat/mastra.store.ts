import { PostgresStore } from '@mastra/pg';

export const pStore = new PostgresStore({
  id: 'netamplify-store',
  connectionString: process.env.DATABASE_URL!,
});

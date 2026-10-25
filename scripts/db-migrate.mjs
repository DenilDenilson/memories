import 'dotenv/config';
import { createDatabaseClient, migrateDatabase } from './database.mjs';

const client = createDatabaseClient();
try {
  const before = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'denil_%' ORDER BY name",
  );
  await migrateDatabase(client);
  const after = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'denil_%' ORDER BY name",
  );
  console.log(
    'Tablas de denil-memories:',
    after.rows.map((r) => r.name).join(', '),
  );
  console.log(
    'Tablas ajenas conservadas:',
    before.rows.map((r) => r.name).join(', ') || '(ninguna)',
  );
} finally {
  client.close();
}

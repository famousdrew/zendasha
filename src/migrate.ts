import fs from 'fs';
import path from 'path';
import { pool } from './db';

async function migrate() {
  const migrationDir = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    console.log(`Running migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationDir, file), 'utf-8');
    await pool.query(sql);
    console.log(`  Done.`);
  }

  await pool.end();
  console.log('All migrations complete.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

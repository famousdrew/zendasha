import { runFullSync } from './sync/runner';
import { pool } from './db';

async function main() {
  try {
    const results = await runFullSync();
    const failed = results.filter((r) => r.error);

    if (failed.length > 0) {
      console.error(`\n${failed.length} sync(s) failed.`);
      process.exit(1);
    }

    console.log('\nAll syncs succeeded.');
  } catch (err) {
    console.error('Fatal sync error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

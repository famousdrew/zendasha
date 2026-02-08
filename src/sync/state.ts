import { pool } from '../db';

export async function getLastSyncTime(entity: string): Promise<number | null> {
  const result = await pool.query(
    'SELECT last_synced_at FROM sync_state WHERE entity = $1',
    [entity]
  );
  return result.rows.length > 0 ? Number(result.rows[0].last_synced_at) : null;
}

export async function setLastSyncTime(entity: string, timestamp: number): Promise<void> {
  await pool.query(
    `INSERT INTO sync_state (entity, last_synced_at, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (entity) DO UPDATE SET last_synced_at = $2, updated_at = NOW()`,
    [entity, timestamp]
  );
}

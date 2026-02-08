import { pool } from '../db';
import { paginate } from './client';

interface ZendeskGroup {
  id: number;
  name: string;
}

export async function syncGroups(): Promise<number> {
  console.log('Syncing groups...');
  let count = 0;

  for await (const groups of paginate<ZendeskGroup>('/api/v2/groups.json', 'groups')) {
    for (const group of groups) {
      await pool.query(
        `INSERT INTO groups (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET name = $2`,
        [group.id, group.name]
      );
      count++;
    }
  }

  console.log(`  Synced ${count} groups.`);
  return count;
}

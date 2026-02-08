import { pool } from '../db';
import { paginate } from './client';

interface ZendeskUser {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
  default_group_id: number | null;
}

async function upsertUsers(users: ZendeskUser[]): Promise<number> {
  let count = 0;
  for (const user of users) {
    await pool.query(
      `INSERT INTO agents (id, name, email, role, active, default_group_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = $2, email = $3, role = $4, active = $5, default_group_id = $6`,
      [user.id, user.name, user.email, user.role, user.active, user.default_group_id]
    );
    count++;
  }
  return count;
}

export async function syncAgents(): Promise<number> {
  console.log('Syncing agents...');
  let count = 0;

  for (const role of ['agent', 'admin']) {
    for await (const users of paginate<ZendeskUser>('/api/v2/users.json', 'users', { role })) {
      count += await upsertUsers(users);
    }
  }

  console.log(`  Synced ${count} agents.`);
  return count;
}

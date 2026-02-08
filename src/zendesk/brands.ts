import { pool } from '../db';
import { paginate } from './client';

interface ZendeskBrand {
  id: number;
  name: string;
  subdomain: string;
}

export async function syncBrands(): Promise<number> {
  console.log('Syncing brands...');
  let count = 0;

  for await (const brands of paginate<ZendeskBrand>('/api/v2/brands.json', 'brands')) {
    for (const brand of brands) {
      await pool.query(
        `INSERT INTO brands (id, name, subdomain)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = $2, subdomain = $3`,
        [brand.id, brand.name, brand.subdomain]
      );
      count++;
    }
  }

  console.log(`  Synced ${count} brands.`);
  return count;
}

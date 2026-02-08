import dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  zendesk: {
    subdomain: required('ZENDESK_SUBDOMAIN'),
    email: required('ZENDESK_EMAIL'),
    apiToken: required('ZENDESK_API_TOKEN'),
  },
  database: {
    url: required('DATABASE_URL'),
  },
  sync: {
    backfillMonths: parseInt(process.env.BACKFILL_MONTHS || '3', 10),
  },
};

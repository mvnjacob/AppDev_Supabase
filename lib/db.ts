import { Pool, PoolClient, QueryResultRow, QueryResult } from 'pg';

const globalForPool = global as unknown as { pool: Pool };

const dbHost = process.env.DB_HOST;
const isLocalhost = !!dbHost && dbHost.includes('localhost');
const isSupabasePooler = !!dbHost && dbHost.includes('.pooler.supabase.com');
const resolvedPort = Number(process.env.DB_PORT || (isSupabasePooler ? 6543 : 5432));

const connectionConfig = {
  host: dbHost,
  port: resolvedPort,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: isLocalhost ? false : {
    rejectUnauthorized: false, 
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
};

// Fallback to connection string if individual vars are missing but DATABASE_URL is present
const finalConfig = (process.env.DB_HOST) 
  ? connectionConfig 
  : { 
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false } 
    };

if (!dbHost && !process.env.DATABASE_URL) {
  console.error("❌ Database configuration missing. Please set DB_HOST/DB_USER/etc. or DATABASE_URL in .env.local");
} else {
  if (dbHost) {
    console.log(`ℹ️ Database Config: Host=${dbHost}, User=${process.env.DB_USER}, DB=${process.env.DB_NAME}, Port=${resolvedPort}`);
  } else {
    console.log("ℹ️ Database Config: Using DATABASE_URL");
  }
}

export const pool = globalForPool.pool || new Pool(finalConfig);

if (process.env.NODE_ENV !== 'production') globalForPool.pool = pool;

// Debug: Log connection status
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Verify connection on startup
(async () => {
  try {
    if (!dbHost && !process.env.DATABASE_URL) {
      console.warn("⚠️ Skipping DB connection verification because configuration is missing");
      return;
    }
    console.log("ℹ️ Attempting to connect to database...");
    const client = await pool.connect();
    console.log('✅ Database connected successfully');
    // const res = await client.query('SELECT NOW()');
    // console.log('✅ Database time:', res.rows[0].now);
    client.release();
  } catch (err) {
    console.error('❌ Database connection failed:', err);
    if (err instanceof Error) {
        // console.error('Error stack:', err.stack);
    }
  }
})();

// ----------------------------
// Reusable query function
// Using 'unknown' or a generic T instead of 'any'
// ----------------------------
export const query = <T extends QueryResultRow = QueryResultRow>(
  text: string, 
  params?: unknown[]
): Promise<QueryResult<T>> => pool.query<T>(text, params);

// ----------------------------
// Optional helper: get a client for transactions
// ----------------------------
export const getClient = async () => {
  const client = await pool.connect();
  return {
    client,
    release: () => client.release(),
    query: <T extends QueryResultRow = QueryResultRow>(
        text: string, 
        params?: unknown[]
    ) => client.query<T>(text, params),
  };
};

// ----------------------------
// Optional helper: simple transaction wrapper
// ----------------------------
export const transaction = async <T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
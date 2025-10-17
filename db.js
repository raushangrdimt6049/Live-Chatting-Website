const { Pool } = require('pg');

// Render provides a DATABASE_URL environment variable for the database service.
// We use this in production, and fall back to the .env variables for local development.
const connectionConfig = process.env.DATABASE_URL ? 
  {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Required for Render's managed DB
    }
  } : 
  {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  };

const pool = new Pool(connectionConfig);

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

const createTable = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender VARCHAR(50) NOT NULL,
      content JSONB NOT NULL,
      time_string VARCHAR(50) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      is_seen BOOLEAN DEFAULT FALSE,
      seen_at TIMESTAMP WITH TIME ZONE,
      reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL
    );
  `;
  try {
    // Using pool.connect() is more robust for initial setup
    const client = await pool.connect();
    try {
      await client.query(queryText);
    } finally {
      client.release();
    }
    console.log('"messages" table is ready.');
  } catch (err) {
    let errorMessage = 'Error creating messages table. Please check your database connection credentials in .env.';
    if (err.code === 'ENOTFOUND') {
      errorMessage += `\nDNS lookup failed for host: ${err.hostname}. If using a cloud database (like Render), ensure you are using the EXTERNAL connection URL for local development.`;
    }
    console.error(errorMessage, err);
    throw err; // Re-throw the error to be caught by the caller
  }
};

module.exports = { pool, createTable };
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
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
      seen_at TIMESTAMP WITH TIME ZONE
    );
  `;
  try {
    await pool.query(queryText);
    console.log('"messages" table is ready.');
  } catch (err) {
    console.error('Error creating messages table', err.stack);
  }
};

module.exports = { pool, createTable };
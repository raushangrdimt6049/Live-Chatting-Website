const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 3000;

// --- Database Connection ---
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- WebSocket Logic ---
wss.on('connection', ws => {
  console.log('Client connected');
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

function broadcastMessage(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// --- Database Table Setup ---
const setupDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender VARCHAR(50) NOT NULL,
        content JSONB NOT NULL,
        time_string VARCHAR(50) NOT NULL,
        is_seen BOOLEAN DEFAULT false,
        seen_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Database table is ready.');
  } catch (err) {
    console.error('Error setting up database:', err);
  }
};

// --- Middleware ---
// Serve the static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // To parse JSON bodies

// --- API Endpoints ---

// Get the last 20 messages
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM messages ORDER BY created_at DESC LIMIT 20');
    res.json(result.rows.reverse()); // reverse to show oldest first
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Post a new message
app.post('/api/messages', async (req, res) => {
  try {
    const { sender, content, timeString } = req.body;
    const result = await pool.query(
      'INSERT INTO messages (sender, content, time_string) VALUES ($1, $2, $3) RETURNING *',
      [sender, content, timeString]
    );
    const newMessage = result.rows[0];
    broadcastMessage(newMessage); // Broadcast the new message
    res.status(201).json(newMessage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Start the HTTP and WebSocket Server ---
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  setupDatabase();
});
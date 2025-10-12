require('dotenv').config(); // Load environment variables
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { pool, createTable } = require('./db');

const app = express();
const server = http.createServer(app);

// Use a dynamic port from the environment or default to 3000
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json({ limit: '10mb' })); // Increase limit for images

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname))); // Serve from the root where index.html is

// Initialize Database Table
createTable();

// WebSocket server setup
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        // This is now only for real-time events like typing, not for messages
        wss.clients.forEach((client) => {
            if (client.readyState === ws.OPEN) {
                client.send(message.toString());
            }
        });
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// API to get all messages
app.get('/api/messages', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM messages ORDER BY created_at ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// API to post a new message
app.post('/api/messages', async (req, res) => {
    const { sender, content, timeString } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO messages (sender, content, time_string) VALUES ($1, $2, $3) RETURNING *',
            [sender, content, timeString]
        );
        const newMessage = result.rows[0];

        // Broadcast the new message to all connected WebSocket clients
        wss.clients.forEach((client) => {
            if (client.readyState === client.OPEN) {
                client.send(JSON.stringify(newMessage));
            }
        });

        res.status(201).json(newMessage);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.get('/', (req, res) => {
    // This route serves the main HTML file
    res.sendFile(path.join(__dirname, 'index.html')); 
});

server.listen(PORT, () => {
    console.log(`Server is listening on http://localhost:${PORT}`);
});
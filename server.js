require('dotenv').config(); // Load environment variables
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { pool, createTable } = require('./db'); // db.js will also be in the root

const app = express();
const server = http.createServer(app);

// Use a dynamic port from the environment or default to 3000
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json({ limit: '10mb' })); // Increase limit for images

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Database Table
createTable();

// WebSocket server setup
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        // This is for real-time events like typing
        const data = JSON.parse(message.toString());

        // Broadcast typing events to all clients except the sender
        // This prevents the user from seeing their own "is typing" indicator.
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                if (data.type === 'typing' || data.type === 'stop_typing') {
                    client.send(JSON.stringify(data));
                }
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
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'new_message',
                    payload: newMessage
                }));
            }
        });

        res.status(201).json(newMessage);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// API to clear all messages
app.delete('/api/messages', async (req, res) => {
    try {
        // TRUNCATE is faster than DELETE for clearing a whole table and resets the ID sequence.
        await pool.query('TRUNCATE TABLE messages RESTART IDENTITY');
        console.log('Chat history cleared from database.');

        // Broadcast a clear event to all connected clients
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'chat_cleared' }));
            }
        });

        res.status(204).send(); // 204 No Content is a standard success response for DELETE
    } catch (err) {
        console.error('Error clearing chat history:', err);
        res.status(500).send('Server Error');
    }
});

app.get('/', (req, res) => {
    // This route serves the main HTML file
    res.sendFile(path.join(__dirname, 'public', 'index.html')); 
});

server.listen(PORT, () => {
    console.log(`Server is listening on http://localhost:${PORT}`);
});
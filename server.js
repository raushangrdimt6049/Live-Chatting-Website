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

// WebSocket server setup
const wss = new WebSocketServer({ server });

// Map to store clients and their associated user
const clients = new Map();

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (rawMessage) => {
        const data = JSON.parse(rawMessage.toString());

        // Handle user registration on login
        if (data.type === 'register') {
            const user = data.payload.user;
            ws.user = user; // Associate user with this WebSocket connection
            clients.set(user, ws);
            console.log(`User '${user}' registered`);

            // Notify all other clients that this user is now online
            wss.clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'user_status', payload: { user, status: 'online' } }));
                }
            });

            // Inform the newly connected user about the status of the other user
            const otherUser = user === 'raushan' ? 'nisha' : 'raushan';
            const otherUserSocket = clients.get(otherUser);
            const otherUserStatus = otherUserSocket && otherUserSocket.readyState === WebSocket.OPEN ? 'online' : 'offline';
            ws.send(JSON.stringify({ type: 'user_status', payload: { user: otherUser, status: otherUserStatus } }));
            // Also send self-status to correctly initialize UI
            ws.send(JSON.stringify({ type: 'user_status', payload: { user: user, status: 'online' } }));

            return;
        }

        // --- WebRTC Signaling and General Message Forwarding ---
        const recipientUser = data.payload?.to;

        // Handle messages that need to be relayed to a specific user
        // This includes all WebRTC signaling messages.
        if (recipientUser && (data.type.startsWith('call-') || data.type === 'ice-candidate' || data.type === 'user-busy')) {
                const recipientWs = clients.get(recipientUser);
                if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                    // Forward the message to the specific recipient
                    recipientWs.send(JSON.stringify(data));
                } else {
                    console.log(`Call recipient '${recipientUser}' not found or not connected.`);
                }
            return; // Stop processing after relaying the targeted message
        }

        // For all other messages (chat, typing, seen status, etc.), broadcast to all clients.
        // The client-side will decide whether to display the information.
        // This is simpler and more robust for general events.
        wss.clients.forEach((client) => {
            // Broadcast to all clients. The client-side logic will handle not re-rendering for the sender.
            // This ensures events like 'messages_seen' and 'chat_cleared' reach everyone.
            if (client.readyState === WebSocket.OPEN) {
                 client.send(JSON.stringify(data));
             }
        });
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        // Remove user from the clients map on disconnect
        if (ws.user) {
            clients.delete(ws.user);
            const disconnectedUser = ws.user;
            console.log(`User '${disconnectedUser}' unregistered`);

            // Notify all other clients that this user is now offline
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    // Send offline status update
                    client.send(JSON.stringify({ type: 'user_status', payload: { user: disconnectedUser, status: 'offline' } }));

                    // Also, if the remaining client is in a call, tell them to end it.
                    // This is a proactive way to terminate calls on disconnect.
                    client.send(JSON.stringify({
                        type: 'call-end',
                        payload: { from: disconnectedUser, reason: 'disconnect' }
                    }));
                }
            });
        }
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
        console.error('Error fetching messages:', err);
        res.status(500).send('Server Error');
    }
});

// API to post a new message
app.post('/api/messages', async (req, res) => {
    const { sender, content, timeString } = req.body;
    // The 'is_seen' and 'seen_at' columns have defaults, so we don't need to specify them on insert.
    try {
        const result = await pool.query(
            'INSERT INTO messages (sender, content, time_string) VALUES ($1, $2, $3) RETURNING *',
            [sender, JSON.stringify(content), timeString]
        );
        const newMessage = result.rows[0];

        // Add recipient to the message payload for client-side logic
        newMessage.recipient = sender === 'raushan' ? 'nisha' : 'raushan';

        // Broadcast the new message to all connected WebSocket clients
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'new_message',
                    payload: newMessage
                }));
                // Also notify clients to update their unread counts
                client.send(JSON.stringify({
                    type: 'unread_count_update',
                    payload: { recipient: newMessage.recipient }
                }));
            }
        });

        res.status(201).json(newMessage);
    } catch (err) {
        console.error('Error posting message:', err);
        res.status(500).json({ error: 'Failed to save message', details: err.message });
    }
});

// API to get unread message count for a user
app.get('/api/messages/unread-count', async (req, res) => {
    const { user } = req.query; // e.g., 'raushan' or 'nisha'
    if (!user) {
        return res.status(400).json({ error: 'User query parameter is required.' });
    }

    // The receiver is the user passed in the query. We count messages sent by the OTHER user.
    const sender = user === 'raushan' ? 'nisha' : 'raushan';

    try {
        const result = await pool.query(
            'SELECT COUNT(*) FROM messages WHERE sender = $1 AND is_seen = FALSE',
            [sender]
        );
        res.json({ count: parseInt(result.rows[0].count, 10) });
    } catch (err) {
        console.error('Error fetching unread count:', err);
        res.status(500).json({ error: 'Failed to fetch unread count' });
    }
});

// API to mark messages as seen
app.post('/api/messages/mark-as-seen', async (req, res) => {
    const { user } = req.body; // The user who is currently viewing the chat
    if (!user) {
        return res.status(400).json({ error: 'User is required in the request body.' });
    }

    // Mark messages sent by the OTHER user as seen
    const sender = user === 'raushan' ? 'nisha' : 'raushan';

    try {
        const result = await pool.query(
            `UPDATE messages SET is_seen = TRUE, seen_at = CURRENT_TIMESTAMP 
             WHERE sender = $1 AND is_seen = FALSE 
             RETURNING *`,
            [sender]
        );

        const updatedMessages = result.rows;
        // Broadcast the fact that these messages have been seen
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'messages_seen', payload: updatedMessages }));
            }
        });
        res.status(200).json(updatedMessages);
    } catch (err) {
        console.error('Error marking messages as seen:', err);
        res.status(500).json({ error: 'Failed to update messages' });
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

const startServer = async () => {
    try {
        // Initialize Database Table and wait for it to be ready
        await createTable();

        server.listen(PORT, () => {
            console.log(`Server is listening on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
};

startServer();
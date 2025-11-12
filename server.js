require('dotenv').config(); // Load environment variables
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { db } = require('./firebase'); // Use Firebase

const app = express();
const server = http.createServer(app);

// Use a dynamic port from the environment or default to 3000
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json({ limit: '10mb' })); // Increase limit for images

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- Secure Login API Endpoint ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // Securely load passwords from environment variables
    const users = {
        "Raushan_143": { password: process.env.RAUSHAN_PASSWORD, key: 'raushan' },
        "Nisha_143": { password: process.env.NISHA_PASSWORD, key: 'nisha' }
    };

    const userCredentials = users[username];

    // Check if user exists and password is correct
    if (userCredentials && userCredentials.password === password) {
        res.status(200).json({ success: true, user: userCredentials.key });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// WebSocket server setup
const wss = new WebSocketServer({ server });

// Map to store clients and their associated user
const clients = new Map(); // Now stores: Map<string, Set<WebSocket>>

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (rawMessage) => {
        const data = JSON.parse(rawMessage.toString());

        // Handle user registration on login
        if (data.type === 'register') {
            const user = data.payload.user;
            ws.user = user; // Associate user with this WebSocket connection

            // If the user is connecting for the first time, create a new Set
            if (!clients.has(user)) {
                clients.set(user, new Set());
            }
            // Add the new connection to the user's Set of connections
            clients.get(user).add(ws);
            console.log(`User '${user}' registered a new connection. Total connections for user: ${clients.get(user).size}`);

            // Notify all other clients that this user is now online
            wss.clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'user_status', payload: { user, status: 'online' } }));
                }
            });

            // Inform the newly connected user about the status of the other user
            const otherUser = user === 'raushan' ? 'nisha' : 'raushan';
            const otherUserConnections = clients.get(otherUser);
            const otherUserStatus = (otherUserConnections && otherUserConnections.size > 0) ? 'online' : 'offline';
            ws.send(JSON.stringify({ type: 'user_status', payload: { user: otherUser, status: otherUserStatus } }));
            // Also send self-status to correctly initialize UI
            ws.send(JSON.stringify({ type: 'user_status', payload: { user: user, status: 'online' } }));

            return;
        }

        // Handle request for all user statuses (for initial page load)
        if (data.type === 'get_all_user_statuses') {
            const allStatuses = {
                raushan: clients.has('raushan') ? 'online' : 'offline',
                nisha: clients.has('nisha') ? 'online' : 'offline'
            };
            ws.send(JSON.stringify({
                type: 'all_user_statuses',
                payload: allStatuses
            }));
            return;
        }

        // --- WebRTC Signaling and General Message Forwarding ---
        const recipientUser = data.payload?.to;
        const isSignalingMessage = data.type.startsWith('call-') || data.type.startsWith('voice-chat-') || data.type.startsWith('live-video-') || data.type.startsWith('sound_alert') || ['ice-candidate', 'user-busy'].includes(data.type);

        // Handle messages that need to be relayed to a specific user
        // This includes all WebRTC signaling messages.
        if (recipientUser && isSignalingMessage) {
            const recipientConnections = clients.get(recipientUser);
            if (recipientConnections && recipientConnections.size > 0) {
                // Send to all connections for that user
                recipientConnections.forEach(recipientWs => {
                    if (recipientWs.readyState === WebSocket.OPEN) recipientWs.send(rawMessage.toString());
                });
            } else {
                // If recipient is not found, do nothing. The caller's client will handle the timeout or the alert will just not be delivered.
                console.log(`Call recipient '${recipientUser}' not found or not connected. Call will not be delivered.`);
            }
            return; // Stop processing after relaying the targeted message
        }

        // For all other messages (chat, typing, seen status, etc.), broadcast to all clients.
        // The client-side will decide whether to display the information.
        // This is simpler and more robust for general events.
        wss.clients.forEach((client) => {
            // Do not send the message back to the original sender.
            // This handles general broadcasts like typing indicators.
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                 client.send(rawMessage.toString());
             }
        });
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        // Remove user from the clients map on disconnect
        if (ws.user) {
            const disconnectedUser = ws.user; // Get the user before deleting
            const userConnections = clients.get(disconnectedUser);

            if (userConnections) {
                userConnections.delete(ws); // Remove the specific connection that closed
                console.log(`User '${disconnectedUser}' connection closed. Remaining connections: ${userConnections.size}`);
                // If that was the last connection for the user, clear the entry from the map
                if (userConnections.size === 0) {
                    clients.delete(disconnectedUser);
                }
            }

            // Wait for a short period before broadcasting the offline status.
            // This gives the client a chance to reconnect without appearing offline.
            setTimeout(() => {
                if (!clients.has(disconnectedUser)) {
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'user_status', payload: { user: disconnectedUser, status: 'offline' } }));
                            client.send(JSON.stringify({ type: 'peer-disconnected', payload: { user: disconnectedUser } }));
                        }
                    });
                }
            }, 5000); // 5-second grace period for reconnection.
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// API to get all messages
app.get('/api/messages', async (req, res) => {
    try {
        const messagesRef = db.ref('messages');
        const snapshot = await messagesRef.orderByChild('created_at').once('value');
        const messages = snapshot.val();

        if (!messages) {
            return res.json([]);
        }

        // Convert messages object to an array and enrich with replied_to data
        const messagesArray = await Promise.all(Object.keys(messages).map(async (key) => {
            const message = { id: key, ...messages[key] };
            if (message.reply_to_id && messages[message.reply_to_id]) {
                const repliedToMsg = messages[message.reply_to_id];
                message.replied_to = {
                    id: message.reply_to_id,
                    sender: repliedToMsg.sender,
                    content: repliedToMsg.content
                };
            }
            return message;
        }));

        res.json(messagesArray);
    } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).send('Server Error');
    }
});

// API to post a new message
app.post('/api/messages', async (req, res) => {
    const { sender, content, timeString, reply_to_id } = req.body;
    try {
        const messagesRef = db.ref('messages');
        const newMessageRef = messagesRef.push(); // Generate a unique, time-ordered key

        const messageData = {
            sender,
            content,
            time_string: timeString,
            reply_to_id: reply_to_id || null,
            is_seen: false,
            seen_at: null,
            created_at: new Date().toISOString()
        };

        await newMessageRef.set(messageData);

        const newMessage = { id: newMessageRef.key, ...messageData };

        // Add recipient to the message payload for client-side logic
        newMessage.recipient = sender === 'raushan' ? 'nisha' : 'raushan';

        // Broadcast the new message to all connected WebSocket clients
        wss.clients.forEach(async (client) => {
            if (client.readyState === WebSocket.OPEN) {                
                // The client-side expects a 'new_message' event with the full payload
                client.send(JSON.stringify({
                    type: 'new_message',
                    // Send the 'newMessage' object which already contains all necessary data
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
        const messagesRef = db.ref('messages');
        const snapshot = await messagesRef.orderByChild('sender').equalTo(sender).once('value');
        const messages = snapshot.val();

        if (!messages) {
            return res.json({ count: 0 });
        }

        let unreadCount = 0;
        Object.values(messages).forEach(msg => {
            if (!msg.is_seen) {
                unreadCount++;
            }
        });
        res.json({ count: unreadCount });
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
        const messagesRef = db.ref('messages');
        const snapshot = await messagesRef.orderByChild('sender').equalTo(sender).once('value');
        const messagesToUpdate = snapshot.val();

        if (!messagesToUpdate) {
            return res.status(200).json([]);
        }

        const updates = {};
        const seenAtTimestamp = new Date().toISOString();
        const seenMessages = [];

        Object.keys(messagesToUpdate).forEach(key => {
            const message = messagesToUpdate[key];
            if (!message.is_seen) {
                updates[`/${key}/is_seen`] = true;
                updates[`/${key}/seen_at`] = seenAtTimestamp;
            }
            // Collect all messages from the sender that are now considered seen
            seenMessages.push({ id: key, ...message, is_seen: true, seen_at: updates[`/${key}/seen_at`] || message.seen_at });
        });

        if (Object.keys(updates).length > 0) {
            await messagesRef.update(updates);
        }

        // Broadcast the full list of seen messages to all clients.
        wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify({ type: 'messages_seen', payload: seenMessages })); } });
        res.status(200).json(seenMessages);
    } catch (err) {
        console.error('Error marking messages as seen:', err);
        res.status(500).json({ error: 'Failed to update messages' });
    }
});

// API to clear all messages
app.delete('/api/messages', async (req, res) => {
    try {
        const messagesRef = db.ref('messages');
        await messagesRef.remove();
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
        // Firebase is initialized in firebase.js

        server.listen(PORT, () => {
            console.log(`Server is listening on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
};

startServer();
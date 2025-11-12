const admin = require('firebase-admin');
const path = require('path'); // Import the path module

// Load environment variables
require('dotenv').config();

try {
    // Load the service account key from the specified file path
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!serviceAccountPath) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH environment variable is not set.');
    }
    // Use path.resolve to ensure the path is absolute, then require the JSON file
    const serviceAccount = require(path.resolve(__dirname, serviceAccountPath));

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });

    console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
    console.error('Error initializing Firebase Admin SDK. Please ensure:');
    console.error('1. Your service account JSON file exists at the path specified in FIREBASE_SERVICE_ACCOUNT_PATH in your .env file.');
    console.error('2. The FIREBASE_DATABASE_URL is correctly set in your .env file.');
    console.error('Original Error:', error);
    process.exit(1);
}

module.exports = { db: admin.database() };
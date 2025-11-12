const admin = require('firebase-admin');

// Check if the required environment variables are set
if (!process.env.APP_DATABASE_URL || !process.env.APP_SERVICE_ACCOUNT_PATH) {
  console.error("Firebase environment variables APP_DATABASE_URL and APP_SERVICE_ACCOUNT_PATH must be set.");
  process.exit(1);
}

const serviceAccount = require(process.env.APP_SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.APP_DATABASE_URL
});

const db = admin.database();

module.exports = { db };
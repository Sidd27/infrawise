import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL!);
const db = client.db('appdb');

// BAD: collection scan — find() with no filter → MongoCollectionScan
export async function getAllSessions() {
  return db.collection('sessions').find();
}

// BAD: userId has no index on sessions → MissingMongoIndex
export async function getSessionsByUser(userId: string) {
  return db.collection('sessions').find({ userId });
}

// BAD: collection scan on activity_logs
export async function getAllActivityLogs() {
  return db.collection('activity_logs').find();
}

// BAD: userId has no index on activity_logs → MissingMongoIndex
export async function getActivityByUser(userId: string) {
  return db.collection('activity_logs').find({ userId });
}

// BAD: recipientId has no index on notifications → MissingMongoIndex
export async function getNotificationsForRecipient(recipientId: string) {
  return db.collection('notifications').find({ recipientId });
}

// BAD: status has no index on notifications → MissingMongoIndex
export async function getPendingNotifications() {
  return db.collection('notifications').find({ status: 'pending' });
}

// GOOD: users collection has indexes on email + role — no finding expected
export async function getUserByEmail(email: string) {
  return db.collection('users').findOne({ email });
}

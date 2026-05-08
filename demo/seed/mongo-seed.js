// Run with: mongosh mongodb://localhost:27017 demo/seed/mongo-seed.js

// ── Collections WITHOUT indexes (triggers MissingMongoIndexAnalyzer) ──

db = db.getSiblingDB('appdb');

db.sessions.drop();
db.sessions.insertMany([
  { userId: 'u1', token: 'tok-abc', createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000) },
  { userId: 'u2', token: 'tok-def', createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000) },
  { userId: 'u1', token: 'tok-xyz', createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000) },
]);
// intentionally no indexes on userId or token

db.activity_logs.drop();
db.activity_logs.insertMany([
  { userId: 'u1', action: 'login',    resource: '/dashboard', ts: new Date() },
  { userId: 'u2', action: 'purchase', resource: '/checkout',  ts: new Date() },
  { userId: 'u1', action: 'logout',   resource: '/dashboard', ts: new Date() },
]);
// intentionally no indexes on userId or action

db.notifications.drop();
db.notifications.insertMany([
  { recipientId: 'u1', type: 'email', status: 'pending',  createdAt: new Date() },
  { recipientId: 'u2', type: 'push',  status: 'sent',     createdAt: new Date() },
  { recipientId: 'u1', type: 'sms',   status: 'failed',   createdAt: new Date() },
]);
// intentionally no indexes on recipientId or status

// ── Collection WITH indexes (control) ──

db.users.drop();
db.users.insertMany([
  { email: 'alice@example.com', name: 'Alice', role: 'admin' },
  { email: 'bob@example.com',   name: 'Bob',   role: 'user' },
]);
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ role: 1 });

print('MongoDB seed complete');
print('  appdb.sessions         — no indexes (intentional)');
print('  appdb.activity_logs    — no indexes (intentional)');
print('  appdb.notifications    — no indexes (intentional)');
print('  appdb.users            — indexed on email + role (control)');

import { MongoClient } from 'mongodb';
import type { MongoCollectionMetadata, MongoIndexMetadata } from '@infrawise/shared';
import { InfrawiseError, logger } from '@infrawise/core';

const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);

export class MongoConnectionError extends InfrawiseError {
  constructor(details?: string) {
    super(
      'Unable to connect to MongoDB.\n\nPossible reasons:\n- invalid connection string\n- port 27017 not accessible\n- wrong credentials\n\nRun: infrawise doctor',
      undefined,
      undefined,
    );
    this.name = 'MongoConnectionError';
    if (details) {
      this.message = `Unable to connect to MongoDB.\n\nPossible reasons:\n- invalid connection string\n- port 27017 not accessible\n- wrong credentials\n\nRun: infrawise doctor\n\nDetail: ${details}`;
    }
  }
}

export type { MongoCollectionMetadata, MongoIndexMetadata };

export async function extractMongoMetadata(
  connectionString: string,
  databases?: string[],
): Promise<MongoCollectionMetadata[]> {
  const client = new MongoClient(connectionString, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });

  try {
    await client.connect();

    // Determine which databases to introspect
    let dbNames: string[];
    if (databases && databases.length > 0) {
      dbNames = databases;
    } else {
      const adminDb = client.db('admin');
      const dbList = await adminDb.admin().listDatabases();
      dbNames = dbList.databases
        .map((d) => d.name)
        .filter((name) => !SYSTEM_DATABASES.has(name));
    }

    logger.info(`Introspecting ${dbNames.length} MongoDB database(s)`);

    const results: MongoCollectionMetadata[] = [];

    for (const dbName of dbNames) {
      const db = client.db(dbName);

      let collectionNames: string[];
      try {
        const collections = await db.listCollections().toArray();
        collectionNames = collections.map((c) => c.name);
      } catch (err) {
        logger.warn(`Skipping database "${dbName}": ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      for (const collName of collectionNames) {
        const collection = db.collection(collName);

        let rawIndexes: Record<string, unknown>[] = [];
        try {
          rawIndexes = (await collection.indexes()) as Record<string, unknown>[];
        } catch {
          rawIndexes = [];
        }

        let estimatedCount = 0;
        try {
          estimatedCount = await collection.estimatedDocumentCount();
        } catch {
          estimatedCount = 0;
        }

        const indexes: MongoIndexMetadata[] = rawIndexes.map((idx) => ({
          name: String(idx['name'] ?? ''),
          keys: (idx['key'] ?? {}) as Record<string, unknown>,
          unique: Boolean(idx['unique']),
          sparse: Boolean(idx['sparse']),
        }));

        results.push({
          database: dbName,
          collection: collName,
          indexes,
          estimatedCount,
        });
      }
    }

    logger.info(`Found ${results.length} MongoDB collection(s)`);
    return results;
  } catch (err) {
    if (err instanceof MongoConnectionError) throw err;
    throw new MongoConnectionError(err instanceof Error ? err.message : String(err));
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function validateMongoAccess(connectionString: string): Promise<boolean> {
  const client = new MongoClient(connectionString, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close().catch(() => undefined);
  }
}

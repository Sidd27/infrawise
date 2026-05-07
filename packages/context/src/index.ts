import * as path from 'path';
import * as fs from 'fs';
import { Project, SyntaxKind, Node, CallExpression, StringLiteral } from 'ts-morph';
import type { ExtractedOperation } from '@infrawise/shared';
import { RepositoryScanError, logger } from '@infrawise/core';

const DYNAMO_OPERATIONS = new Set([
  'query',
  'scan',
  'getItem',
  'putItem',
  'updateItem',
  'deleteItem',
  'batchGetItem',
  'batchWriteItem',
  'transactGetItems',
  'transactWriteItems',
  // Also handle command class names (AWS SDK v3)
  'QueryCommand',
  'ScanCommand',
  'GetItemCommand',
  'PutItemCommand',
  'UpdateItemCommand',
  'DeleteItemCommand',
]);

const DYNAMO_CLIENT_PATTERNS = ['DynamoDBClient', 'DynamoDB', 'dynamoDB', 'dynamo', 'ddb'];

const POSTGRES_QUERY_METHODS = new Set(['query', 'execute', 'exec']);

const KNEX_METHODS = new Set(['select', 'where', 'join', 'from', 'insert', 'update', 'delete', 'del']);

// MySQL-specific patterns
const MYSQL_QUERY_METHODS = new Set(['query', 'execute', 'exec']);
const MYSQL_CLIENT_PATTERNS = ['mysql', 'mysql2', 'connection', 'pool', 'conn'];

// MongoDB-specific patterns
const MONGO_READ_METHODS = new Set([
  'find',
  'findOne',
  'findById',
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'aggregate',
  'countDocuments',
  'estimatedDocumentCount',
]);
const MONGO_COLLECTION_METHODS = new Set(['collection']);

const PRISMA_METHODS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'create',
  'update',
  'upsert',
  'delete',
  'deleteMany',
  'updateMany',
]);

function getEnclosingFunctionName(node: Node): string {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current) ||
      Node.isArrowFunction(current) ||
      Node.isMethodDeclaration(current)
    ) {
      if (Node.isFunctionDeclaration(current) || Node.isMethodDeclaration(current)) {
        return current.getName() ?? '<anonymous>';
      }
      // Arrow function or function expression — check if assigned to a variable
      const parent = current.getParent();
      if (parent && Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
      if (parent && Node.isPropertyAssignment(parent)) {
        return parent.getName();
      }
      return '<anonymous>';
    }
    current = current.getParent();
  }
  return '<module>';
}

function extractTableNameFromArg(arg: Node): string {
  if (Node.isStringLiteral(arg)) {
    return (arg as StringLiteral).getLiteralValue();
  }
  if (Node.isObjectLiteralExpression(arg)) {
    // Look for TableName property
    for (const prop of arg.getProperties()) {
      if (Node.isPropertyAssignment(prop) && prop.getName() === 'TableName') {
        const init = prop.getInitializer();
        if (init && Node.isStringLiteral(init)) {
          return (init as StringLiteral).getLiteralValue();
        }
      }
    }
  }
  return 'unknown';
}

function detectDynamoOperations(
  callExpr: CallExpression,
  filePath: string,
): ExtractedOperation | null {
  const expr = callExpr.getExpression();
  const args = callExpr.getArguments();

  // Pattern 1: client.send(new QueryCommand({ TableName: '...' }))
  if (Node.isPropertyAccessExpression(expr)) {
    const methodName = expr.getName();
    if (methodName === 'send' && args.length > 0) {
      const firstArg = args[0];
      if (Node.isNewExpression(firstArg)) {
        const className = firstArg.getExpression().getText();
        if (DYNAMO_OPERATIONS.has(className)) {
          const cmdArgs = firstArg.getArguments();
          const tableName = cmdArgs.length > 0 ? extractTableNameFromArg(cmdArgs[0]) : 'unknown';
          return {
            functionName: getEnclosingFunctionName(callExpr),
            operationType: className,
            databaseType: 'dynamodb',
            target: tableName,
            filePath,
          };
        }
      }
    }

    // Pattern 2: dynamoClient.query({ TableName: '...' })  (v2-style)
    if (DYNAMO_OPERATIONS.has(methodName)) {
      const objText = expr.getExpression().getText().toLowerCase();
      if (DYNAMO_CLIENT_PATTERNS.some((p) => objText.includes(p.toLowerCase()))) {
        const tableName = args.length > 0 ? extractTableNameFromArg(args[0]) : 'unknown';
        return {
          functionName: getEnclosingFunctionName(callExpr),
          operationType: methodName,
          databaseType: 'dynamodb',
          target: tableName,
          filePath,
        };
      }
    }
  }

  return null;
}

function extractSqlTableName(sql: string): string {
  // Try to extract table name from common SQL patterns
  const patterns = [
    /FROM\s+["']?(\w+)["']?/i,
    /INTO\s+["']?(\w+)["']?/i,
    /UPDATE\s+["']?(\w+)["']?/i,
    /JOIN\s+["']?(\w+)["']?/i,
  ];
  for (const pattern of patterns) {
    const match = sql.match(pattern);
    if (match?.[1]) return match[1];
  }
  return 'unknown';
}

function detectPostgresOperations(
  callExpr: CallExpression,
  filePath: string,
): ExtractedOperation | null {
  const expr = callExpr.getExpression();
  const args = callExpr.getArguments();

  if (!Node.isPropertyAccessExpression(expr)) return null;

  const methodName = expr.getName();
  const objExpr = expr.getExpression();

  // Pattern: pool.query(...) / client.query(...)
  if (POSTGRES_QUERY_METHODS.has(methodName)) {
    const objText = objExpr.getText().toLowerCase();
    if (
      objText.includes('pool') ||
      objText.includes('client') ||
      objText.includes('db') ||
      objText.includes('pg') ||
      objText.includes('conn')
    ) {
      let tableName = 'unknown';
      if (args.length > 0) {
        const firstArg = args[0];
        if (Node.isStringLiteral(firstArg)) {
          tableName = extractSqlTableName((firstArg as StringLiteral).getLiteralValue());
        } else if (Node.isNoSubstitutionTemplateLiteral(firstArg)) {
          tableName = extractSqlTableName(firstArg.getLiteralText());
        } else if (Node.isTemplateExpression(firstArg)) {
          // Template literal — extract what we can from the head
          tableName = extractSqlTableName(firstArg.getHead().getLiteralText());
        }
      }
      return {
        functionName: getEnclosingFunctionName(callExpr),
        operationType: 'query',
        databaseType: 'postgres',
        target: tableName,
        filePath,
      };
    }
  }

  // Pattern: Prisma — prisma.user.findMany(), prisma.orders.create()
  if (PRISMA_METHODS.has(methodName)) {
    const accessChain = objExpr;
    if (Node.isPropertyAccessExpression(accessChain)) {
      const modelName = accessChain.getName();
      const rootObj = accessChain.getExpression().getText().toLowerCase();
      if (rootObj.includes('prisma')) {
        return {
          functionName: getEnclosingFunctionName(callExpr),
          operationType: methodName,
          databaseType: 'postgres',
          target: modelName,
          filePath,
        };
      }
    }
  }

  // Pattern: Knex — knex('tableName').select() or db('tableName').where()
  if (KNEX_METHODS.has(methodName)) {
    const calleeText = objExpr.getText();
    // Check if it's a chained knex call
    if (
      calleeText.includes('knex') ||
      calleeText.includes('db(') ||
      calleeText.includes('trx(')
    ) {
      return {
        functionName: getEnclosingFunctionName(callExpr),
        operationType: methodName,
        databaseType: 'postgres',
        target: 'unknown',
        filePath,
      };
    }
    // Knex call expression style: knex('users').select(...)
    if (Node.isCallExpression(objExpr)) {
      const innerExpr = objExpr.getExpression();
      if (innerExpr.getText().toLowerCase().match(/knex|db|trx/)) {
        const innerArgs = objExpr.getArguments();
        const tableName =
          innerArgs.length > 0 && Node.isStringLiteral(innerArgs[0])
            ? (innerArgs[0] as StringLiteral).getLiteralValue()
            : 'unknown';
        return {
          functionName: getEnclosingFunctionName(callExpr),
          operationType: methodName,
          databaseType: 'postgres',
          target: tableName,
          filePath,
        };
      }
    }
  }

  return null;
}

function detectMySQLOperations(
  callExpr: CallExpression,
  filePath: string,
): ExtractedOperation | null {
  const expr = callExpr.getExpression();
  const args = callExpr.getArguments();

  if (!Node.isPropertyAccessExpression(expr)) return null;

  const methodName = expr.getName();
  const objExpr = expr.getExpression();
  const objText = objExpr.getText().toLowerCase();

  // Pattern: connection.query(...) / pool.query(...) / mysql.query(...)
  if (MYSQL_QUERY_METHODS.has(methodName)) {
    const isMysqlClient = MYSQL_CLIENT_PATTERNS.some((p) => objText.includes(p.toLowerCase()));
    if (isMysqlClient) {
      let tableName = 'unknown';
      if (args.length > 0) {
        const firstArg = args[0];
        if (Node.isStringLiteral(firstArg)) {
          tableName = extractSqlTableName((firstArg as StringLiteral).getLiteralValue());
        } else if (Node.isNoSubstitutionTemplateLiteral(firstArg)) {
          tableName = extractSqlTableName(firstArg.getLiteralText());
        } else if (Node.isTemplateExpression(firstArg)) {
          tableName = extractSqlTableName(firstArg.getHead().getLiteralText());
        }
      }
      return {
        functionName: getEnclosingFunctionName(callExpr),
        operationType: 'query',
        databaseType: 'mysql',
        target: tableName,
        filePath,
      };
    }
  }

  // Pattern: knex with mysql dialect — same knex methods but with mysql hint in object text
  if (KNEX_METHODS.has(methodName)) {
    if (objText.includes('mysql') || objText.includes('knex')) {
      let tableName = 'unknown';
      if (Node.isCallExpression(objExpr)) {
        const innerArgs = objExpr.getArguments();
        if (innerArgs.length > 0 && Node.isStringLiteral(innerArgs[0])) {
          tableName = (innerArgs[0] as StringLiteral).getLiteralValue();
        }
      }
      return {
        functionName: getEnclosingFunctionName(callExpr),
        operationType: methodName,
        databaseType: 'mysql',
        target: tableName,
        filePath,
      };
    }
  }

  return null;
}

function detectMongoOperations(
  callExpr: CallExpression,
  filePath: string,
): ExtractedOperation | null {
  const expr = callExpr.getExpression();

  if (!Node.isPropertyAccessExpression(expr)) return null;

  const methodName = expr.getName();
  const objExpr = expr.getExpression();

  // Pattern: collection.find(), collection.findOne(), collection.insertOne(), etc.
  if (MONGO_READ_METHODS.has(methodName)) {
    const objText = objExpr.getText().toLowerCase();
    // Check if the receiver looks like a collection reference
    if (
      objText.includes('collection') ||
      objText.includes('col') ||
      objText.includes('db.') ||
      objText.includes('model') ||
      // Mongoose: User.find(), Order.findOne()
      /^[A-Z][a-zA-Z]+$/.test(objExpr.getText())
    ) {
      let collectionName = 'unknown';

      // Try to get collection name from db.collection('name')
      if (Node.isCallExpression(objExpr)) {
        const innerExpr = objExpr.getExpression();
        if (
          Node.isPropertyAccessExpression(innerExpr) &&
          MONGO_COLLECTION_METHODS.has(innerExpr.getName())
        ) {
          const innerArgs = objExpr.getArguments();
          if (innerArgs.length > 0 && Node.isStringLiteral(innerArgs[0])) {
            collectionName = (innerArgs[0] as StringLiteral).getLiteralValue();
          }
        }
      } else if (Node.isPropertyAccessExpression(objExpr)) {
        // db.users.find() → collection name is the property
        collectionName = objExpr.getName();
      } else {
        // Mongoose model — use variable name as hint
        collectionName = objExpr.getText();
      }

      const opType = methodName === 'find' || methodName === 'aggregate' ? 'scan' : 'query';

      return {
        functionName: getEnclosingFunctionName(callExpr),
        operationType: opType,
        databaseType: 'mongodb',
        target: collectionName,
        filePath,
      };
    }
  }

  // Pattern: db.collection('name').find() — detect the db.collection() call itself
  if (MONGO_COLLECTION_METHODS.has(methodName)) {
    const args = callExpr.getArguments();
    const objText = objExpr.getText().toLowerCase();
    if (objText.includes('db') || objText.includes('mongo')) {
      const collectionName =
        args.length > 0 && Node.isStringLiteral(args[0])
          ? (args[0] as StringLiteral).getLiteralValue()
          : 'unknown';
      return {
        functionName: getEnclosingFunctionName(callExpr),
        operationType: 'query',
        databaseType: 'mongodb',
        target: collectionName,
        filePath,
      };
    }
  }

  return null;
}

export async function scanRepository(repoPath: string): Promise<ExtractedOperation[]> {
  const resolvedPath = path.resolve(repoPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new RepositoryScanError(`Path does not exist: ${resolvedPath}`);
  }

  const tsconfigPath = path.join(resolvedPath, 'tsconfig.json');
  const hasTsConfig = fs.existsSync(tsconfigPath);

  const project = new Project({
    tsConfigFilePath: hasTsConfig ? tsconfigPath : undefined,
    compilerOptions: hasTsConfig
      ? undefined
      : {
          target: 99,
          allowJs: true,
        },
    skipAddingFilesFromTsConfig: !hasTsConfig,
  });

  if (!hasTsConfig) {
    // Manually add .ts and .tsx files
    project.addSourceFilesAtPaths([
      path.join(resolvedPath, '**/*.ts'),
      path.join(resolvedPath, '**/*.tsx'),
      `!${path.join(resolvedPath, '**/node_modules/**')}`,
      `!${path.join(resolvedPath, '**/dist/**')}`,
    ]);
  }

  const sourceFiles = project.getSourceFiles();
  logger.info(`Scanning ${sourceFiles.length} TypeScript file(s) in ${resolvedPath}`);

  const operations: ExtractedOperation[] = [];

  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();

    // Skip node_modules and dist
    if (filePath.includes('node_modules') || filePath.includes('/dist/')) continue;

    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const callExpr of callExpressions) {
      const dynamoOp = detectDynamoOperations(callExpr, filePath);
      if (dynamoOp) {
        operations.push(dynamoOp);
        continue;
      }

      const postgresOp = detectPostgresOperations(callExpr, filePath);
      if (postgresOp) {
        operations.push(postgresOp);
        continue;
      }

      const mysqlOp = detectMySQLOperations(callExpr, filePath);
      if (mysqlOp) {
        operations.push(mysqlOp);
        continue;
      }

      const mongoOp = detectMongoOperations(callExpr, filePath);
      if (mongoOp) {
        operations.push(mongoOp);
      }
    }
  }

  logger.info(`Extracted ${operations.length} database operation(s)`);
  return operations;
}

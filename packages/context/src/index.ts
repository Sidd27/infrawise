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
      }
    }
  }

  logger.info(`Extracted ${operations.length} database operation(s)`);
  return operations;
}

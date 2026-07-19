import ast
import json
import os
import re
import sys

EXCLUDED_DIRS = {'node_modules', 'venv', '.venv', 'site-packages', '__pycache__', 'dist'}

SQS_METHODS = {'send_message', 'send_message_batch', 'receive_message', 'delete_message'}
SNS_METHODS = {'publish', 'publish_batch'}
SSM_METHODS = {'get_parameter', 'get_parameters', 'get_parameters_by_path'}
SECRETS_METHODS = {'get_secret_value'}
LAMBDA_METHODS = {'invoke', 'invoke_async'}
DYNAMO_METHODS = {'query', 'scan', 'get_item', 'put_item', 'update_item', 'delete_item',
                  'batch_get_item', 'batch_write_item'}
SQL_METHODS = {'execute', 'executemany'}
SQL_RECEIVER_HINTS = ('cursor', 'cur', 'conn', 'connection', 'session', 'db', 'pool',
                      'pg', 'psycopg', 'asyncpg', 'engine', 'mysql', 'pymysql', 'maria')
MYSQL_HINTS = ('mysql', 'pymysql', 'maria')
SQL_TABLE_PATTERNS = [
    re.compile(r'FROM\s+["\']?(\w+)["\']?', re.IGNORECASE),
    re.compile(r'INTO\s+["\']?(\w+)["\']?', re.IGNORECASE),
    re.compile(r'UPDATE\s+["\']?(\w+)["\']?', re.IGNORECASE),
    re.compile(r'JOIN\s+["\']?(\w+)["\']?', re.IGNORECASE),
]

MONGO_METHODS = {'find', 'find_one', 'insert_one', 'insert_many', 'update_one', 'update_many',
                 'delete_one', 'delete_many', 'aggregate', 'count_documents',
                 'estimated_document_count'}
MONGO_SCAN_METHODS = {'find', 'aggregate'}
MONGO_BASE_HINTS = ('db', 'mongo')
KAFKA_PRODUCER_METHODS = {'send', 'produce'}
KAFKA_HINTS = ('kafka', 'producer', 'consumer')

SERVICE_RULES = [
    ('sqs', SQS_METHODS, ('QueueUrl', 'QueueName'), ('sqs', 'queue')),
    ('sns', SNS_METHODS, ('TopicArn', 'TargetArn'), ('sns', 'topic')),
    ('ssm', SSM_METHODS, ('Name', 'Path'), ('ssm', 'parameter')),
    ('secretsmanager', SECRETS_METHODS, ('SecretId',), ('secret',)),
    ('lambda', LAMBDA_METHODS, ('FunctionName',), ('lambda', 'fn')),
]


def expr_text(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return expr_text(node.value) + '.' + node.attr
    if isinstance(node, ast.Call):
        return expr_text(node.func) + '()'
    if isinstance(node, ast.Subscript):
        return expr_text(node.value) + '[]'
    return ''


def short_name(val):
    if val.startswith('http://') or val.startswith('https://'):
        return val.rstrip('/').rsplit('/', 1)[-1]
    if ':' in val:
        return val.rsplit(':', 1)[-1]
    return val


def sql_table(sql):
    for pattern in SQL_TABLE_PATTERNS:
        match = pattern.search(sql)
        if match:
            return match.group(1)
    return 'unknown'


def const_str(node):
    if isinstance(node, ast.Index):  # py3.8 compat
        node = node.value
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def is_secret_string_ref(node):
    if isinstance(node, ast.Attribute) and node.attr == 'SecretString':
        return True
    if isinstance(node, ast.Subscript):
        return const_str(node.slice) == 'SecretString'
    return False


def is_json_loads_secret(node):
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == 'loads'
        and expr_text(node.func.value) == 'json'
        and node.args
        and is_secret_string_ref(node.args[0])
    )


class Visitor(ast.NodeVisitor):
    def __init__(self, file_path):
        self.file_path = file_path
        self.ops = []
        self.stack = []
        self.strings = {}
        self.boto_clients = {}
        self.dynamo_tables = {}
        self.collections = {}

    def function_name(self):
        return self.stack[-1] if self.stack else '<module>'

    def add(self, op_type, service, target):
        self.ops.append({
            'functionName': self.function_name(),
            'operationType': op_type,
            'serviceType': service,
            'target': target,
            'filePath': self.file_path,
        })

    def visit_FunctionDef(self, node):
        self.stack.append(node.name)
        start = len(self.ops)
        self.generic_visit(node)
        keys = self.find_secret_keys(node)
        if keys:
            for op in self.ops[start:]:
                if op['serviceType'] == 'secretsmanager':
                    op['keys'] = keys
        self.stack.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    # Finds json.loads(x['SecretString']) usage in this function and collects the key names
    # accessed on the parsed result (via subscript or .get) — never the secret values.
    def find_secret_keys(self, func_node):
        keys = set()
        tracked_vars = set()

        for n in ast.walk(func_node):
            if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
                if is_json_loads_secret(n.value):
                    tracked_vars.add(n.targets[0].id)
                elif isinstance(n.value, ast.Subscript) and is_json_loads_secret(n.value.value):
                    key = const_str(n.value.slice)
                    if key:
                        keys.add(key)

        if not tracked_vars:
            return sorted(keys)

        for n in ast.walk(func_node):
            if isinstance(n, ast.Subscript) and isinstance(n.value, ast.Name) and n.value.id in tracked_vars:
                key = const_str(n.slice)
                if key:
                    keys.add(key)
            elif (
                isinstance(n, ast.Call)
                and isinstance(n.func, ast.Attribute)
                and n.func.attr == 'get'
                and isinstance(n.func.value, ast.Name)
                and n.func.value.id in tracked_vars
                and n.args
            ):
                key = const_str(n.args[0])
                if key:
                    keys.add(key)

        return sorted(keys)

    def resolve_string(self, node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.Name):
            return self.strings.get(node.id)
        if isinstance(node, ast.JoinedStr):
            parts = []
            for value in node.values:
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    parts.append(value.value)
                elif isinstance(value, ast.FormattedValue):
                    resolved = self.resolve_string(value.value)
                    if resolved is None:
                        return None
                    parts.append(resolved)
                else:
                    return None
            return ''.join(parts)
        return None

    def kwarg(self, node, keys):
        for kw in node.keywords:
            if kw.arg in keys:
                return self.resolve_string(kw.value)
        return None

    def boto3_service(self, node):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in ('client', 'resource')
            and expr_text(node.func.value) == 'boto3'
            and node.args
        ):
            return self.resolve_string(node.args[0])
        return None

    def table_name(self, node):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == 'Table'
            and node.args
        ):
            return self.resolve_string(node.args[0])
        return None

    def collection_name(self, node):
        if isinstance(node, ast.Subscript):
            base = expr_text(node.value).lower()
            if any(h in base for h in MONGO_BASE_HINTS):
                return self.resolve_string(node.slice)
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == 'get_collection'
            and node.args
        ):
            return self.resolve_string(node.args[0])
        return None

    def visit_Assign(self, node):
        if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            resolved = self.resolve_string(node.value)
            if resolved is not None:
                self.strings[name] = resolved
            else:
                service = self.boto3_service(node.value)
                table = self.table_name(node.value)
                collection = self.collection_name(node.value)
                if service is not None:
                    self.boto_clients[name] = service
                elif table is not None:
                    self.dynamo_tables[name] = table
                elif collection is not None:
                    self.collections[name] = collection
        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Attribute):
            method = node.func.attr
            recv = node.func.value
            recv_text = expr_text(recv).lower()
            _ = (
                self.detect_dynamo(node, method, recv, recv_text)
                or self.detect_sql(node, method, recv_text)
                or self.detect_mongo(node, method, recv, recv_text)
                or self.detect_kafka(node, method, recv_text)
                or self.detect_aws_client(node, method, recv, recv_text)
            )
        self.generic_visit(node)

    def detect_dynamo(self, node, method, recv, recv_text):
        if method not in DYNAMO_METHODS:
            return False
        if isinstance(recv, ast.Name) and recv.id in self.dynamo_tables:
            self.add(method, 'dynamodb', self.dynamo_tables[recv.id])
            return True
        inline = self.table_name(recv)
        if inline is not None:
            self.add(method, 'dynamodb', inline)
            return True
        kw = self.kwarg(node, ('TableName',))
        tracked = isinstance(recv, ast.Name) and self.boto_clients.get(recv.id) == 'dynamodb'
        if kw is not None or tracked or 'dynamo' in recv_text or 'ddb' in recv_text:
            self.add(method, 'dynamodb', kw if kw else 'unknown')
            return True
        return False

    def detect_sql(self, node, method, recv_text):
        if method not in SQL_METHODS:
            return False
        if not any(h in recv_text for h in SQL_RECEIVER_HINTS):
            return False
        sql = None
        if node.args:
            arg = node.args[0]
            if (
                isinstance(arg, ast.Call)
                and isinstance(arg.func, ast.Name)
                and arg.func.id == 'text'
                and arg.args
            ):
                arg = arg.args[0]
            sql = self.resolve_string(arg)
        service = 'mysql' if any(h in recv_text for h in MYSQL_HINTS) else 'postgres'
        self.add('query', service, sql_table(sql) if sql else 'unknown')
        return True

    def detect_mongo(self, node, method, recv, recv_text):
        if method not in MONGO_METHODS:
            return False
        collection = None
        if isinstance(recv, ast.Name) and recv.id in self.collections:
            collection = self.collections[recv.id]
        elif isinstance(recv, ast.Attribute):
            base = expr_text(recv.value).lower()
            if any(h in base for h in MONGO_BASE_HINTS):
                collection = recv.attr
        else:
            collection = self.collection_name(recv)
        if collection is None and ('collection' in recv_text or 'mongo' in recv_text):
            collection = 'unknown'
        if collection is None:
            return False
        op_type = 'scan' if method in MONGO_SCAN_METHODS else 'query'
        self.add(op_type, 'mongodb', collection)
        return True

    def detect_kafka(self, node, method, recv_text):
        if not any(h in recv_text for h in KAFKA_HINTS):
            return False
        if method in KAFKA_PRODUCER_METHODS:
            target = self.resolve_string(node.args[0]) if node.args else None
            self.add(method, 'kafka', target if target else 'unknown')
            return True
        if method == 'subscribe':
            topics = []
            if node.args and isinstance(node.args[0], (ast.List, ast.Tuple)):
                for element in node.args[0].elts:
                    resolved = self.resolve_string(element)
                    if resolved is not None:
                        topics.append(resolved)
            elif node.args:
                resolved = self.resolve_string(node.args[0])
                if resolved is not None:
                    topics.append(resolved)
            for topic in topics or ['unknown']:
                self.add('subscribe', 'kafka', topic)
            return True
        return False

    def detect_aws_client(self, node, method, recv, recv_text):
        for service, methods, keys, hints in SERVICE_RULES:
            if method not in methods:
                continue
            tracked = isinstance(recv, ast.Name) and self.boto_clients.get(recv.id) == service
            target = self.kwarg(node, keys)
            if tracked or target is not None or any(h in recv_text for h in hints):
                self.add(method, service, short_name(target) if target else 'unknown')
                return True
        return False


def find_py_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS and not d.startswith('.')]
        for f in filenames:
            if f.endswith('.py'):
                yield os.path.join(dirpath, f)


def main():
    root = os.path.abspath(sys.argv[1])
    ops = []
    for file_path in find_py_files(root):
        try:
            with open(file_path, 'r', encoding='utf-8', errors='replace') as fh:
                tree = ast.parse(fh.read())
        except SyntaxError:
            continue
        visitor = Visitor(file_path)
        visitor.visit(tree)
        ops.extend(visitor.ops)
    print(json.dumps(ops))


if __name__ == '__main__':
    main()

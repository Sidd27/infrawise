def python_trailing_column(cursor, customer_id):
    cursor.execute('SELECT id FROM index_access_cases WHERE customer_id = %s', (customer_id,))


def python_dynamic_query(cursor, sql):
    cursor.execute(sql)

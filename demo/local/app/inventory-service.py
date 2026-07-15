import boto3

dynamodb = boto3.resource('dynamodb')
inventory = dynamodb.Table('local-inventory')
sqs = boto3.client('sqs')
sns = boto3.client('sns')


def reserve_stock(event, context):
    item = inventory.get_item(Key={'sku': event['sku']})
    inventory.update_item(
        Key={'sku': event['sku']},
        UpdateExpression='SET reserved = reserved + :q',
        ExpressionAttributeValues={':q': event['quantity']},
    )
    sqs.send_message(QueueUrl='local-stock-events', MessageBody=event['sku'])
    return item


def notify_low_stock(producer, sku):
    sns.publish(TopicArn='arn:aws:sns:us-west-2:000000000000:local-alerts', Message=sku)
    producer.send('stock-low', sku.encode())

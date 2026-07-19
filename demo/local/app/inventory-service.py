import boto3
import json

dynamodb = boto3.resource('dynamodb')
inventory = dynamodb.Table('local-inventory')
sqs = boto3.client('sqs')
sns = boto3.client('sns')
secrets = boto3.client('secretsmanager')


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


# Demonstrates secret key inference: get_secrets_overview reports referencedKeys: ["key"]
# for "demo/stripe-api-key", inferred here from a subscript access — the value is never read by infrawise.
def get_stripe_key():
    response = secrets.get_secret_value(SecretId='demo/stripe-api-key')
    secret = json.loads(response['SecretString'])
    return secret['key']

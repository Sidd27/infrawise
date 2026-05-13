import { Kafka } from 'kafkajs';

const kafka = new Kafka({ brokers: [process.env.KAFKA_BROKER ?? 'localhost:9092'] });
const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'event-service' });

// BAD: publishes to order-events — no schema validation, no DLQ equivalent
export async function publishOrderCreated(orderId: string, userId: string) {
  await producer.send({
    topic: 'order-events',
    messages: [{ value: JSON.stringify({ type: 'order.created', orderId, userId }) }],
  });
}

// BAD: publishes to payment-events — no error handling if broker is unavailable
export async function publishPaymentProcessed(orderId: string, amount: number) {
  await producer.send({
    topic: 'payment-events',
    messages: [{ value: JSON.stringify({ type: 'payment.processed', orderId, amount }) }],
  });
}

// CONSUMER: subscribes to order-events — processes fulfillment
export async function startFulfillmentConsumer() {
  await consumer.subscribe({ topic: 'order-events' });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const event = JSON.parse(message.value?.toString() ?? '{}');
      console.log('Fulfilling order:', event.orderId);
    },
  });
}

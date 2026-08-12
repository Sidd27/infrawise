// Kafka producer/consumer, extracted from code alone — no broker is contacted.
// Exercises the producer/consumer mapping on get_topic_details, and the topic's
// `encrypted: null`: an AST scan cannot observe broker TLS, so it claims nothing.
import { Kafka } from 'kafkajs';

const kafka = new Kafka({ clientId: 'floci-demo', brokers: ['localhost:9092'] });

export async function publishOrderPlaced(orderId: string) {
  const producer = kafka.producer();
  await producer.connect();
  await producer.send({
    topic: 'order-placed',
    messages: [{ key: orderId, value: JSON.stringify({ orderId }) }],
  });
}

export async function consumeOrderPlaced() {
  const consumer = kafka.consumer({ groupId: 'floci-demo-group' });
  await consumer.connect();
  await consumer.subscribe({ topic: 'order-placed', fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      JSON.parse(message.value?.toString() ?? '{}');
    },
  });
}

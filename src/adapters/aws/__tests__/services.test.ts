import { describe, it, expect } from 'vitest';
import { lambdaNameFromIntegrationUri, partialReads } from '../services.js';
import { PartialExtractionError } from '../../../core/index.js';

describe('lambdaNameFromIntegrationUri', () => {
  it('reads the name from a REST API invoke path', () => {
    expect(
      lambdaNameFromIntegrationUri(
        'arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:orders-handler/invocations',
      ),
    ).toBe('orders-handler');
  });

  it('reads the name from a bare function ARN (HTTP API AWS_PROXY)', () => {
    expect(
      lambdaNameFromIntegrationUri('arn:aws:lambda:us-east-1:123456789012:function:orders-handler'),
    ).toBe('orders-handler');
  });

  it('ignores an alias or version qualifier', () => {
    expect(
      lambdaNameFromIntegrationUri(
        'arn:aws:lambda:us-east-1:123456789012:function:orders-handler:live',
      ),
    ).toBe('orders-handler');
  });

  it('returns undefined for non-Lambda integrations', () => {
    expect(lambdaNameFromIntegrationUri('https://internal.example.com/orders')).toBeUndefined();
    expect(lambdaNameFromIntegrationUri(undefined)).toBeUndefined();
  });
});

// A per-item read failure must reach the caller as "unread", never as an empty
// list that reads like "does not exist".
describe('partialReads', () => {
  it('returns the data untouched when nothing was lost', () => {
    const partial = partialReads('SQS');
    expect(partial.settle(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('throws a partial extraction carrying what was read', () => {
    const partial = partialReads('SQS');
    partial.note('orders-queue', new Error('AccessDenied'));
    try {
      partial.settle(['payments-queue']);
      expect.unreachable('settle must throw once something was lost');
    } catch (err) {
      expect(err).toBeInstanceOf(PartialExtractionError);
      const pe = err as PartialExtractionError<string[]>;
      expect(pe.message).toBe('SQS unread: orders-queue');
      expect(pe.data).toEqual(['payments-queue']);
    }
  });

  it('records a loss with no error attached', () => {
    const partial = partialReads('Kinesis');
    partial.note('events-stream');
    expect(() => partial.settle([])).toThrow('Kinesis unread: events-stream');
  });

  it('caps the message at five names and counts the rest', () => {
    const partial = partialReads('SNS');
    for (let i = 1; i <= 8; i++) partial.note(`t${i}`);
    expect(() => partial.settle([])).toThrow('SNS unread: t1, t2, t3, t4, t5 and 3 more');
  });
});

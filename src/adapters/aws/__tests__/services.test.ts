import { describe, it, expect } from 'vitest';
import { lambdaNameFromIntegrationUri } from '../services.js';

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

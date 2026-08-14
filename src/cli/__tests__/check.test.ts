// Copyright 2026 ManSio
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, it, expect } from 'vitest';
import { evaluateCheck } from '../commands/check.js';
import type { Finding } from '../../types.js';

function finding(severity: Finding['severity'], issue = 'planted'): Finding {
  return { severity, issue, description: '', recommendation: '' };
}

describe('evaluateCheck — negative controls for the CI gate', () => {
  it('a planted HIGH finding must flip the verdict (check would fail)', () => {
    const { violations } = evaluateCheck([finding('high')]);
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe('high');
  });

  it('a clean finding set passes', () => {
    expect(evaluateCheck([finding('low')]).violations).toHaveLength(0);
    expect(evaluateCheck([]).violations).toHaveLength(0);
  });

  it('below-threshold findings pass with the default failOn=high', () => {
    expect(
      evaluateCheck([finding('medium'), finding('low'), finding('verify')]).violations,
    ).toHaveLength(0);
  });

  it('failOn=medium promotes medium findings to violations', () => {
    const { violations } = evaluateCheck([finding('medium'), finding('low')], 'medium');
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe('medium');
  });

  it('surfaces failed extraction sources — half-read infra cannot look clean', () => {
    const { failedSources } = evaluateCheck([], 'high', [
      { service: 'sqs', status: 'failed', error: 'AccessDenied: sqs:ListQueues' },
      { service: 'lambda', status: 'ok' },
      { service: 's3', status: 'disabled' },
    ]);
    expect(failedSources).toHaveLength(1);
    expect(failedSources[0].service).toBe('sqs');
    expect(failedSources[0].error).toContain('AccessDenied');
  });

  it('a planted HIGH finding still fails the gate even when other sources failed', () => {
    const { violations, failedSources } = evaluateCheck([finding('high')], 'high', [
      { service: 'rds', status: 'failed', error: 'timeout' },
    ]);
    expect(violations).toHaveLength(1);
    expect(failedSources).toHaveLength(1);
  });
});

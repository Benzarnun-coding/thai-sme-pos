import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canWrite, roleOf } from './roles.ts';

test('cost editors may change costs only; everyone else everything', () => {
  const editors = ['climax@example.com'];
  assert.equal(roleOf('Climax@Example.com', editors), 'costs');
  assert.equal(roleOf('benz@example.com', editors), 'admin');
  for (const [m, p] of [['POST', '/api/costs'], ['DELETE', '/api/costs'], ['POST', '/api/campaign-costs/sync'], ['PUT', '/api/sections/s1'], ['POST', '/api/sections']]) {
    assert.equal(canWrite('costs', m, p), true, `${m} ${p}`);
  }
  for (const [m, p] of [['POST', '/api/entities/1/budget'], ['POST', '/api/entities/1/status'], ['POST', '/api/bulk/budget'], ['PUT', '/api/settings'], ['PUT', '/api/stages/winning'], ['PUT', '/api/campaigns/1'], ['POST', '/api/run'], ['DELETE', '/api/sections/s1']]) {
    assert.equal(canWrite('costs', m, p), false, `${m} ${p}`);
  }
  assert.equal(canWrite('costs', 'GET', '/api/overview'), true);
  assert.equal(canWrite('admin', 'POST', '/api/bulk/budget'), true);
});

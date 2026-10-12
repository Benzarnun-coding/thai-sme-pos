import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canWrite, roleOf } from './roles.ts';

test('roles: owners from the var, then the users table, then the old cost-editor list, else viewer', () => {
  const users = new Map([['max@example.com', 'owner' as const], ['staff@example.com', 'admin' as const]]);
  assert.equal(roleOf('Benz@Example.com', ['benz@example.com'], users, []), 'owner');
  assert.equal(roleOf('max@example.com', ['benz@example.com'], users, []), 'owner');
  assert.equal(roleOf('staff@example.com', [], users, []), 'admin');
  assert.equal(roleOf('Climax@Example.com', [], users, ['climax@example.com']), 'costs');
  assert.equal(roleOf('someone@example.com', [], users, []), 'viewer');
  for (const [m, p] of [['POST', '/api/users'], ['PUT', '/api/users/a%40b.c'], ['DELETE', '/api/users/a%40b.c'], ['POST', '/api/users/access-sync']]) {
    assert.equal(canWrite('owner', m, p), true, `owner ${m} ${p}`);
    assert.equal(canWrite('admin', m, p), false, `admin ${m} ${p}`);
  }
  assert.equal(canWrite('admin', 'POST', '/api/bulk/budget'), true);
  assert.equal(canWrite('viewer', 'POST', '/api/costs'), false);
  assert.equal(canWrite('viewer', 'GET', '/api/overview'), true);
  for (const [m, p] of [['POST', '/api/costs'], ['DELETE', '/api/costs'], ['POST', '/api/campaign-costs/sync'], ['PUT', '/api/sections/s1'], ['POST', '/api/sections'], ['PUT', '/api/actual-sales/2026-10-08']]) {
    assert.equal(canWrite('costs', m, p), true, `${m} ${p}`);
  }
  for (const [m, p] of [['POST', '/api/entities/1/budget'], ['POST', '/api/entities/1/status'], ['POST', '/api/bulk/budget'], ['PUT', '/api/settings'], ['PUT', '/api/stages/winning'], ['PUT', '/api/campaigns/1'], ['POST', '/api/run'], ['DELETE', '/api/sections/s1']]) {
    assert.equal(canWrite('costs', m, p), false, `${m} ${p}`);
  }
  assert.equal(canWrite('costs', 'GET', '/api/overview'), true);
  assert.equal(canWrite('admin', 'POST', '/api/bulk/budget'), true);
});

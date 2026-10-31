import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import { SYSTEM, buildParams } from '../src/renderer/js/advisor-core.js';

const require = createRequire(import.meta.url);

test('手機版與桌面版的軍師提示詞一致', () => {
  const desktop = require('../src/main/advisor.js').SYSTEM;
  assert.equal(SYSTEM, desktop);
  assert.ok(SYSTEM.includes('合約橋牌'));
});

test('軍師請求參數', () => {
  const p = buildParams({ model: 'claude-opus-5-5', effort: 'low' }, [{ role: 'user', content: 'hi' }], 4000);
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.fallbacks, 'default');
  assert.equal(buildParams({ model: 'claude-haiku-5-5' }, [], 100).fallbacks, undefined);
});

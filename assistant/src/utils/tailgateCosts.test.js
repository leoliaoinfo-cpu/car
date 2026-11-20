import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCostCatalog } from './pricing.js';

test('新成本表有 2.5 尺尾門與雙缸油壓缸成本', () => {
  const c = normalizeCostCatalog(null);
  assert.equal(c.addons['qa-tailgate-25'].cost, 32000);
  assert.equal(c.addons['qa-tailgate-double-cylinder'].cost, 8000);
  assert.equal(c.addons['qa-tailgate-35'].cost, 35000);
});

test('舊成本表升級只補沒有的，使用者填過的成本不動', () => {
  const c = normalizeCostCatalog({ version: 22, addons: { 'qa-tailgate-25': { cost: 33000 } } });
  assert.equal(c.addons['qa-tailgate-25'].cost, 33000);
  assert.equal(c.addons['qa-tailgate-double-cylinder'].cost, 8000);
});

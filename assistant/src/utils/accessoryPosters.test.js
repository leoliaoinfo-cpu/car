// 配件海報（使用者 2026-11-20 提供）：新增的 7 個配件與跟現有重疊、價格相同的 6 個配件。
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuotePresets } from './crm.js';
import { normalizeCostCatalog } from './pricing.js';

const NEW_ITEMS = [
  ['qa-hana-ac-filter', '周邊配件', 990], ['qa-shift-knob-cover', '周邊配件', 1480], ['qa-dual-fast-charger', '周邊配件', 1580],
  ['qa-toolbox-side', '客製車體', 8680], ['qa-grille-chrome', '外觀空力', 3680],
  ['qa-armrest-pillow', '周邊配件', 820], ['qa-cooling-seat-cushion', '周邊配件', 649],
];
const SAME_PRICE = [
  ['qa-skid', 12500], ['qa-ext', 8500], ['qa-cargo-led-marker', 1990], ['qa-dashboard-mat', 589], ['qa-k2500-sunshade', 1280], ['qa-keyless-fuel-cap', 599],
];

test('配件海報：新增 7 個配件（售價照海報、成本＝售價八折），重疊的 6 個價格與海報相同', () => {
  const addons = resolveQuotePresets(null).addons;
  const costs = normalizeCostCatalog(null).addons;
  for (const [id, cat, price] of NEW_ITEMS) {
    const a = addons.find((x) => x.id === id);
    assert.ok(a, id);
    assert.equal(a.cat, cat, `${id} 分類`);
    assert.equal(a.price, price, `${id} 售價`);
    assert.equal(costs[id]?.cost, Math.round(price * 0.8), `${id} 成本＝售價八折`);
  }
  for (const [id, price] of SAME_PRICE) assert.equal(addons.find((x) => x.id === id).price, price, id);
  assert.equal(new Set(addons.map((a) => a.id)).size, addons.length); // 沒有重複的品項
  assert.match(addons.find((x) => x.id === 'qa-skid').desc, /噴砂橘/);
});

test('配件海報：舊選單升級會補上新配件與補充說明', () => {
  const up = resolveQuotePresets({ _catalog: 'kavan-2026-v54', addonCategories: ['周邊配件', '金屬製研'], addons: [
    { id: 'qa-k2500-sunshade', cat: '周邊配件', name: '卡旺專用遮陽簾', price: 1280 },
    { id: 'qa-skid', cat: '金屬製研', name: '4WD 專用鋁合金下護板', price: 12500, desc: '適用六期卡旺；原車鎖點結構穩固、防止跳石汙漬擊中中冷器' },
  ] }).addons;
  for (const [id, , price] of NEW_ITEMS) assert.equal(up.find((x) => x.id === id)?.price, price, id);
  assert.match(up.find((x) => x.id === 'qa-k2500-sunshade').desc, /網紗層/);
  assert.match(up.find((x) => x.id === 'qa-skid').desc, /噴砂橘/);
});

test('配件海報：舊成本表升級會補上八折成本，使用者已填的不蓋', () => {
  const up = normalizeCostCatalog({ version: 20, models: {}, addons: { 'qa-armrest-pillow': { cost: 700 } } }).addons;
  assert.equal(up['qa-armrest-pillow'].cost, 700); // 自己填過的不動
  assert.equal(up['qa-hana-ac-filter'].cost, 792);
  assert.equal(up['qa-toolbox-side'].cost, 6944);
});

test('方向盤套改 600（海報為準）：預設 600、舊選單的 499 升級換成 600、自己改過價格的不動；LED 側邊照地燈與警示喇叭維持系統原價', () => {
  const addons = resolveQuotePresets(null).addons;
  const price = (list, id) => list.find((a) => a.id === id)?.price;
  assert.equal(price(addons, 'qa-steering-leather-cover'), 600);
  assert.equal(price(addons, 'qa-puddle-lamp'), 3500); // 用系統的，不是海報的 2,490
  assert.equal(price(addons, 'qa-speaker'), 2800); // 用系統的，不是海報的 2,280
  const mk = (p) => resolveQuotePresets({ _catalog: 'kavan-2026-v55', addonCategories: ['周邊配件'], addons: [
    { id: 'qa-steering-leather-cover', cat: '周邊配件', name: '卡旺方向盤皮革套', price: p },
  ] }).addons;
  assert.equal(price(mk(499), 'qa-steering-leather-cover'), 600);
  assert.equal(price(mk(550), 'qa-steering-leather-cover'), 550);
});

// 「2027 卡旺配件清單」（使用者 2026-11-20 提供的圖一）逐項對照：售價、成本、獎金（＝售價－成本）、保固、備註。
// 這份表是照圖片獨立抄的標準答案，用來檢查系統預設值有沒有跟清單不一致；清單視為最終業務成本標準。
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuotePresets } from './crm.js';
import { normalizeCostCatalog } from './pricing.js';

// [系統品項 id, 清單名稱, 售價, 成本（清單為「*」＝待補則 null）, 獎金, 保固月數（無則 null）, 備註關鍵字]
const LIST_2027 = [
  ['qa-android-surround', '安卓+四錄&環景', 35000, 25000, 10000, 12, ['置物盒']],
  ['qa-tpms-6', '6輪胎壓偵測器', 5000, 4000, 1000, 12, []],
  ['qa-cruise', '定速巡航', 8000, 3000, 5000, 48, []],
  ['qa-media-controls', '多媒體音控', 12000, 8000, 4000, 48, []],
  ['qa-lip', 'KDM前下巴', 9500, 7500, 2000, null, []],
  ['qa-mcover', '後照鏡保護蓋', 2800, 2000, 800, null, []],
  ['qa-turn', '側邊霧白方向燈殼', 1200, null, null, null, []],
  ['qa-tlsound', '音響喇叭升級4P', 9500, 7500, 2000, 12, ['專用線組']],
  ['qa-led', 'LED燈組升級組合價', 15000, 9000, 6000, 6, []],
  ['qa-star-led-head', 'LED頭燈組', 4000, 3000, 1000, 6, []],
  ['qa-star-led-tail', 'LED尾燈組', 2500, 2000, 500, 6, []],
  ['qa-star-led-fog', 'LED霧燈', 1800, 1400, 400, 6, ['黃金', '白光']],
  ['qa-puddle-lamp', 'LED側邊照地燈', 3500, 2500, 1000, 6, ['防水']],
  ['qa-interior-led-single', 'LED室內燈+牌照燈組（單廂）', 500, null, null, 6, []],
  ['qa-interior-led-double', 'LED室內燈+牌照燈組（雙廂）', 600, null, null, 6, []],
  ['qa-phone', '手機架組', 3000, 2300, 700, null, ['中控', '手把']],
  ['qa-mirror1', 'LED韓版後照鏡', 8500, 7000, 1500, 6, []],
  ['qa-mirror2', '全視線後照鏡', 5000, 4000, 1000, null, ['塑料黑']],
  ['qa-speaker', 'GUDE警示喇叭', 2800, 2000, 800, 6, []],
  ['qa-ts', 'TS避震器組', 29800, 25300, 4500, 24, ['定位', '16']],
  ['qa-block', '抗震優力膠', 7800, 6800, 1000, null, []],
  ['qa-atc', 'ATC防傾桿', 18500, 17000, 1500, null, ['2WD']],
  ['qa-leaf', '強化支撐彈簧', 15500, 13500, 2000, null, []],
  ['qa-urea', '尿素桶防撞桿', 5500, 4500, 1000, null, ['橘色', '黑色']],
  ['qa-side', '雙廂滑行測踏組', 18900, 15900, 3000, null, []],
  ['qa-skid', '4WD鋁合金下護板', 12500, 9500, 3000, null, ['4WD', '六期']],
  ['qa-rear', '車尾後防撞桿', 7500, 6000, 1500, null, ['尾門車無法']],
  ['qa-rear-dr-rgb', 'DR車尾後防撞桿(幻彩)', 13800, 11800, 2000, null, ['尾門車無法']],
  ['qa-roof', '車頂行李籃', 15500, 13500, 2000, null, []],
  ['qa-omega', 'OMG鋁圈', 33800, 29800, 4000, null, ['2WD', '全銀', '內黑']],
  ['qa-fog', 'X7魚眼霧燈', 5800, 4300, 1500, 6, ['黃金眼', '白光']],
  ['qa-tail', 'HALO光環尾燈組', 11800, 9300, 2500, 6, ['前方向燈']],
  ['qa-gtr', 'GTR魚眼頭燈組(黑化)', 28900, 25900, 3000, 12, ['雙切', '日行燈', '白光']],
  // 全車烤漆（素色）：清單寫「依車型報價」，系統依車型分三項；獎金都是 3,000
  ['qa-paint1', '全車烤漆（單廂）', 36000, 33000, 3000, null, ['消光', '8000']],
  ['qa-paint2', '全車烤漆（大單廂）', 37000, 34000, 3000, null, ['消光', '8000']],
  ['qa-paint3', '全車烤漆（雙廂）', 39000, 36000, 3000, null, ['消光', '8000']],
  ['qa-android-flagship', '12.3吋安卓四錄旗艦機', 43800, 34800, 9000, 12, ['置物盒']],
  ['qa-boss-mudflap', '304白鋼擋泥板', 3580, 2780, 800, null, ['貼紙']],
];

const presets = resolveQuotePresets(null).addons;
const defaultCosts = normalizeCostCatalog(null).addons;

test('2027 配件清單：每一項的售價、成本、獎金、保固、備註都跟系統一致', () => {
  for (const [id, name, price, cost, bonus, warranty, notes] of LIST_2027) {
    const addon = presets.find((a) => a.id === id);
    assert.ok(addon, `${name}（${id}）系統找不到`);
    assert.equal(addon.price, price, `${name} 售價`);
    assert.ok(!addon.pendingPrice, `${name} 不該是待報價`);
    if (cost == null) {
      assert.equal(defaultCosts[id]?.cost, undefined, `${name} 清單成本是「＊」，系統應維持待補`);
    } else {
      assert.equal(defaultCosts[id]?.cost, cost, `${name} 成本`);
      assert.equal(price - cost, bonus, `${name} 獎金（售價－成本）`);
    }
    assert.equal(addon.warrantyMonths ?? null, warranty, `${name} 保固`);
    for (const word of notes) assert.ok(`${addon.name} ${addon.desc || ''}`.includes(word), `${name} 備註缺「${word}」：${addon.desc}`);
  }
  assert.equal(LIST_2027.length, 38); // 圖一 36 列；全車烤漆依車型拆成 3 項，所以是 38 項
});

test('2027 配件清單：舊成本表（版本 19，舊成本）升級後，清單上的成本一律換成最新標準', () => {
  const old = normalizeCostCatalog({
    version: 19, models: {},
    addons: { 'qa-led': { cost: 9500 }, 'qa-puddle-lamp': { cost: 2800 }, 'qa-leaf': { cost: 14500 }, 'qa-android-flagship': { cost: 33800 } },
  }).addons;
  for (const [id, , , cost] of LIST_2027) {
    if (cost != null && ['qa-led', 'qa-puddle-lamp', 'qa-leaf', 'qa-android-flagship', 'qa-rear-dr-rgb', 'qa-boss-mudflap'].includes(id)) {
      assert.equal(old[id]?.cost, cost, `${id} 升級後成本`);
    }
  }
});

test('2027 配件清單：舊選單（保固、備註還是舊預設）升級後補上新的保固與備註', () => {
  const upgraded = resolveQuotePresets({ _catalog: 'kavan-2026-v49', addonCategories: ['駕駛科技', '金屬製研'], addons: [
    { id: 'qa-android-flagship', cat: '駕駛科技', name: '12.3吋安卓四錄旗艦機（含K2500專用底座）', price: 43800, desc: '12.3吋超寬螢幕；1080P四錄高清；8GB RAM / 128GB ROM；MTK八核心；4G SIM卡聯網；無線CarPlay；K2500專用底座；建議完工價' },
    { id: 'qa-urea', cat: '金屬製研', name: '尿素桶防撞桿', price: 5500, desc: '原車鎖點結構穩固、保護尿素桶防止破損' },
  ] }).addons;
  const flagship = upgraded.find((a) => a.id === 'qa-android-flagship');
  assert.equal(flagship.warrantyMonths, 12);
  assert.ok(flagship.desc.includes('置物盒'));
  assert.ok(upgraded.find((a) => a.id === 'qa-urea').desc.includes('橘色'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_VARIANTS, convertMmToTaiwaneseChi, formatVehiclePrice } from './vehicles.js';
import { dependencyReminders, heightAssessment, requirementPendingItems, requirementSummary } from './reception.js';

test('eight K2500 variants use the current single-source prices', () => {
  assert.equal(VEHICLE_VARIANTS.length, 8);
  assert.deepEqual(VEHICLE_VARIANTS.map((v) => v.msrpTwd), [818000, 858000, 848000, 888000, 988000, 1038000, 978000, 1078000]);
  assert.deepEqual(VEHICLE_VARIANTS.map((v) => v.commissionTwd), [35000, 35000, 35000, 35000, 50000, 50000, 45000, 45000]);
  assert.equal(formatVehiclePrice(858000), '85.8 萬');
});

test('K2500 variants include fuel, urea and practical range notes', () => {
  for (const variant of VEHICLE_VARIANTS) {
    assert.equal(variant.fuelTankL, 65);
    assert.equal(variant.ureaTankL, 14);
    assert.equal(variant.ureaPricePerL, 20);
    assert.equal(variant.estimatedRangeKm, variant.transmission === '自排' ? 580 : 620);
  }
});

test('Taiwanese chi conversion is derived from millimetres', () => {
  assert.equal(convertMmToTaiwaneseChi(3110), '10.26');
  assert.equal(convertMmToTaiwaneseChi(2860), '9.44');
  assert.equal(convertMmToTaiwaneseChi(1870), '6.17');
});

test('tailgate, canvas, height, rack and box dependency reminders are generated', () => {
  const session = { parking: '會', clearanceCm: '220', requirements: {
    升降尾門: { selected: true, size: '3.5' }, 帆布: { selected: true }, H架: { selected: true }, 箱體: { selected: true },
  } };
  const reminders = dependencyReminders(session).join('\n');
  assert.match(reminders, /帆布後方施工/);
  assert.match(reminders, /限高 220cm/);
  assert.match(reminders, /H架/);
  assert.match(reminders, /箱體後方開口/);
});

test('requirements stay separate and expose pending details', () => {
  const session = { requirements: {
    貨斗底板: { selected: true, status: '已確認', material: '白鐵', surface: '花紋／止滑' },
    升降尾門: { selected: true, status: '考慮中', size: '3.5' }, 帆布: { selected: true },
  } };
  assert.deepEqual(requirementSummary(session), ['白鐵／花紋板', '3.5尺升降尾門', '帆布']);
  assert.ok(requirementPendingItems(session).includes('尾門實際承重規格'));
  assert.ok(requirementPendingItems(session).includes('後方帆布與尾門配置'));
});

test('height comparison avoids promises when height-changing accessories exist', () => {
  const variant = VEHICLE_VARIANTS.find((v) => v.id === 'qm-2');
  const result = heightAssessment({ parking: '會', clearanceCm: '220', requirements: { 帆布: { selected: true } } }, variant);
  assert.equal(result.differenceCm, 20.5);
  assert.equal(result.status, '完成車高度待確認');
});

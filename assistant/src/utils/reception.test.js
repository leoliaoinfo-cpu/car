import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_VARIANTS, convertMmToTaiwaneseChi, formatVehiclePrice } from './vehicles.js';
import {
  dependencyReminders, heightAssessment, heightPlanning, heightPlanSummary,
  requirementPendingItems, requirementSummary,
} from './reception.js';

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
  assert.deepEqual(requirementSummary(session), ['白鐵／花紋板', '3.5尺升降尾門', '帆布（規格待確認）']);
  assert.ok(requirementPendingItems(session).includes('尾門實際承重規格'));
  assert.ok(requirementPendingItems(session).includes('尾門連動：尾門尺寸'));
});

test('height comparison avoids promises when height-changing accessories exist', () => {
  const variant = VEHICLE_VARIANTS.find((v) => v.id === 'qm-2');
  const result = heightAssessment({ parking: '會', clearanceCm: '220', requirements: { 帆布: { selected: true } } }, variant);
  assert.equal(result.differenceCm, 20.5);
  assert.equal(result.status, '完成車高度待確認');
});

test('height planning adds suspension lift before calculating usable body height', () => {
  const variant = VEHICLE_VARIANTS.find((v) => v.drive === '2WD');
  const session = {
    parking: '不會', suspensionPlan: '改避震', requirements: {
      帆布: { selected: true, canvasSpec: '自訂／其他', customHeightCm: '180' },
    },
  };
  const result = heightPlanning(session, variant);
  assert.equal(result.baseBedCm, 77);
  assert.equal(result.adjustedBedCm, 82);
  assert.equal(result.controlTotalCm, 270);
  assert.equal(result.availableCm, 188);
  assert.equal(result.itemStatus['帆布'].estimatedTotalCm, 262);
  assert.equal(result.itemStatus['帆布'].canConfirm, true);
});

test('basement clearance reserves safety margin and blocks an over-height canvas', () => {
  const variant = VEHICLE_VARIANTS.find((v) => v.drive === '4WD');
  const session = {
    parking: '會下地下室', clearanceCm: '210', safetyReserveCm: '10', suspensionPlan: '加葉片', requirements: {
      帆布: { selected: true, canvasSpec: '自訂／其他', customHeightCm: '120' },
    },
  };
  const result = heightPlanning(session, variant);
  assert.equal(result.adjustedBedCm, 87.5);
  assert.equal(result.controlTotalCm, 200);
  assert.equal(result.availableCm, 112.5);
  assert.equal(result.itemStatus['帆布'].kind, 'danger');
  assert.equal(result.itemStatus['帆布'].canConfirm, false);
  assert.ok(requirementPendingItems(session, variant).includes('帆布預估超過高度限制'));
});

test('height-sensitive work stays pending until suspension and canvas height are confirmed', () => {
  const variant = VEHICLE_VARIANTS.find((v) => v.drive === '2WD');
  const session = { parking: '不會', requirements: { 帆布: { selected: true, canvasSpec: '標準高' } } };
  const result = heightPlanning(session, variant);
  assert.ok(result.missing.includes('避震／葉片升高方案'));
  assert.ok(result.missing.includes('標準高後台高度'));
  assert.equal(result.itemStatus['帆布'].canConfirm, false);
  assert.match(dependencyReminders(session, variant).join('\n'), /必須先確認是否改避震/);
  assert.match(heightPlanSummary(session, variant), /狀態：⚠️ 待確認/);
});

test('tailgate-only planning does not display a false zero-margin warning', () => {
  const variant = VEHICLE_VARIANTS.find((v) => v.drive === '2WD');
  const session = {
    parking: '不會', suspensionPlan: '原廠高度', requirements: {
      升降尾門: { selected: true, size: '3.5', maxWeight: '300～500kg' },
    },
  };
  const result = heightPlanning(session, variant);
  assert.equal(result.itemStatus['升降尾門'].kind, 'ok');
  assert.equal(result.itemStatus['升降尾門'].marginCm, null);
  assert.match(heightPlanSummary(session, variant), /尾門：3.5尺／300～500kg/);
});

test('canvas and tailgate stay pending until all five coordination checks are complete', () => {
  const variant = VEHICLE_VARIANTS.find((v) => v.drive === '2WD');
  const session = {
    parking: '不會', suspensionPlan: '原廠高度', requirements: {
      帆布: { selected: true, canvasSpec: '自訂／其他', customHeightCm: '150', tailgateCoordination: {} },
      升降尾門: { selected: true, size: '3.5', maxWeight: '300～500kg' },
    },
  };
  let result = heightPlanning(session, variant);
  assert.equal(result.itemStatus['帆布'].canConfirm, false);
  assert.ok(result.itemStatus['帆布'].missing.includes('尾門連動：尾門尺寸'));

  session.requirements['帆布'].tailgateCoordination = {
    tailgateSize: true, rearHeight: true, rearOpening: true, vendorAware: true, finalHeight: true,
  };
  result = heightPlanning(session, variant);
  assert.equal(result.itemStatus['帆布'].canConfirm, true);
  assert.equal(requirementPendingItems(session, variant).some((item) => item.startsWith('尾門連動：')), false);
  assert.match(heightPlanSummary(session, variant), /帆布＋尾門核對：五項已確認/);
});

test('blank custom basement reserve blocks the safety calculation', () => {
  const variant = VEHICLE_VARIANTS.find((v) => v.drive === '2WD');
  const session = {
    parking: '會下地下室', clearanceCm: '210', safetyReserveMode: 'custom', safetyReserveCm: '',
    suspensionPlan: '原廠高度', requirements: {
      帆布: { selected: true, canvasSpec: '自訂／其他', customHeightCm: '100' },
    },
  };
  const result = heightPlanning(session, variant);
  assert.equal(result.controlTotalCm, null);
  assert.ok(result.missing.includes('安全預留高度'));
  assert.equal(result.itemStatus['帆布'].canConfirm, false);
});

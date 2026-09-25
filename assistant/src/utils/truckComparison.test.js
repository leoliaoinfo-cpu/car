import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../data/truckVariants.json' with { type: 'json' };
import {
  comparableTruckValue, isConfirmedUnder3500, truckBrandLabel, truckCompetitorVariants,
  truckMetricDifference, truckMetricDisplay,
} from './truckComparison.js';

const byId = (id) => data.variants.find((row) => row.id === id);

test('imports all 29 non-pickup variant ids and eight K2500 choices', () => {
  assert.equal(data.variants.length, 29);
  assert.equal(new Set(data.variants.map((row) => row.id)).size, 29);
  assert.equal(data.variants.filter((row) => row.brand === 'Kia' && row.model === 'K2500').length, 8);
  assert.deepEqual(data.variants.filter((row) => ['Hilux', 'Ranger', 'Zinger Pickup'].includes(row.model)), []);
});

test('pickup models stay excluded and brands have Chinese names', () => {
  const rows = truckCompetitorVariants([
    ...data.variants,
    { id: 'pickup-guard', brand: 'Ford', model: 'Ranger', body: 'open_bed' },
  ]);
  assert.equal(rows.some((row) => ['Hilux', 'Ranger', 'Zinger Pickup'].includes(row.model)), false);
  assert.equal(truckBrandLabel('Mitsubishi'), '中華三菱 Mitsubishi');
  assert.equal(truckBrandLabel('CMC'), '中華汽車 CMC');
});

test('Porter II conflicted payload is displayed but never compared', () => {
  const porter = byId('porter-ii-01');
  const kia = byId('k2500-01');
  const metric = { key: 'payload_kg', unit: 'kg' };
  assert.equal(comparableTruckValue(porter, 'payload_kg'), null);
  assert.equal(truckMetricDifference(porter, kia, metric), null);
  assert.match(truckMetricDisplay(porter, metric), /原廠資料不一致/);
});

test('model maximum payload is not treated as a version payload', () => {
  const jSpace = byId('j-space-貨卡-22');
  assert.equal(comparableTruckValue(jSpace, 'payload_kg'), null);
  assert.match(truckMetricDisplay(jSpace, { key: 'payload_kg', unit: 'kg' }), /車系最高/);
  assert.equal(isConfirmedUnder3500(jSpace), false);
});

test('vehicle height and loading height remain separate fields', () => {
  const kia = byId('k2500-01');
  assert.equal(comparableTruckValue(kia, 'vehicle_height_mm'), 1995);
  assert.equal(comparableTruckValue(kia, 'bed_loading_height_mm'), 770);
});

test('verified values produce a same-unit numeric difference', () => {
  const townAce = byId('town-ace-貨卡-09');
  const kia = byId('k2500-01');
  assert.equal(truckMetricDifference(kia, townAce, { key: 'payload_kg' }), 495);
});


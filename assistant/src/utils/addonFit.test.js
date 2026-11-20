import test from 'node:test';
import assert from 'node:assert/strict';
import { addonFitWarning } from './addonFit.js';
import { VEHICLE_VARIANTS } from './vehicles.js';

test('配件適用車型：不適用才提醒，還沒選車型或適用就不出現', () => {
  const v = (id) => VEHICLE_VARIANTS.find((x) => x.id === id);
  assert.equal(addonFitWarning('qa-atc', v('qm-1')), ''); // 2WD 單廂
  assert.match(addonFitWarning('qa-atc', v('qm-7')), /適用 2WD，這台是 4WD/);
  assert.match(addonFitWarning('qa-omega', v('qm-8')), /2WD/);
  assert.equal(addonFitWarning('qa-skid', v('qm-7')), '');
  assert.match(addonFitWarning('qa-skid', v('qm-1')), /適用 4WD，這台是 2WD/);
  assert.match(addonFitWarning('qa-side', v('qm-1')), /適用雙廂，這台是單廂/);
  assert.equal(addonFitWarning('qa-side', v('qm-5')), '');
  assert.equal(addonFitWarning('qa-roof', v('qm-3')), ''); // 大單廂可用
  assert.match(addonFitWarning('qa-roof', v('qm-5')), /適用單廂、大單廂，這台是雙廂/);
  assert.equal(addonFitWarning('qa-interior-led-double', v('qm-5')), '');
  assert.match(addonFitWarning('qa-interior-led-single', v('qm-6')), /這台是雙廂/);
  assert.equal(addonFitWarning('qa-atc', null), '');
  assert.equal(addonFitWarning('qa-tpms-6', v('qm-1')), '');
});

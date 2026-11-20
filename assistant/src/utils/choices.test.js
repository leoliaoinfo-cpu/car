import test from 'node:test';
import assert from 'node:assert/strict';
import { choiceGroupsOf, choiceLabelOf, parseChoiceValue, setChoice, isChoiceComplete, missingChoiceLabels, isMultiChoice } from './choices.js';

const single = { choiceLabel: '燈光顏色', choices: ['黃金光', '白光'] };
const multi = { choiceGroups: [{ label: '影像系統', choices: ['四錄', '環景'] }, { label: '後照鏡顏色', choices: ['黑', '白'] }] };

test('一組選項：值直接存選項，選了就完成', () => {
  assert.deepEqual(choiceGroupsOf(single), [{ label: '燈光顏色', choices: ['黃金光', '白光'] }]);
  assert.equal(choiceLabelOf(single), '燈光顏色');
  assert.equal(setChoice(single, '', '燈光顏色', '白光'), '白光');
  assert.equal(isChoiceComplete(single, ''), false);
  assert.equal(isChoiceComplete(single, '白光'), true);
  assert.equal(isChoiceComplete(single, '亂寫'), false);
  assert.equal(isChoiceComplete({}, ''), true); // 沒有選項的配件
});

test('多組選項：每一組都要選，值帶組名', () => {
  assert.equal(isMultiChoice(multi), true);
  assert.equal(choiceLabelOf(multi), '選項');
  let v = setChoice(multi, '', '影像系統', '四錄');
  assert.equal(v, '影像系統：四錄');
  assert.equal(isChoiceComplete(multi, v), false);
  assert.deepEqual(missingChoiceLabels(multi, v), ['後照鏡顏色']);
  v = setChoice(multi, v, '後照鏡顏色', '白');
  assert.equal(v, '影像系統：四錄；後照鏡顏色：白');
  assert.equal(isChoiceComplete(multi, v), true);
  v = setChoice(multi, v, '影像系統', '環景'); // 改選其中一組，另一組保留
  assert.equal(v, '影像系統：環景；後照鏡顏色：白');
  assert.deepEqual(parseChoiceValue(multi, v), { 影像系統: '環景', 後照鏡顏色: '白' });
});

test('多組選項：舊格式（沒有組名）的值視為還沒選，要重選', () => {
  assert.equal(isChoiceComplete(multi, '四錄＋黑色後照鏡'), false);
  assert.equal(isChoiceComplete(multi, '四錄'), false);
});

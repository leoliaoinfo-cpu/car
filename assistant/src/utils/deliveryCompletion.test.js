import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeliveryReminders, defaultAnnualReminders, generateDeliveryWorkflow, planDeliveryCompletion,
  selectPreSaleItemsToClose, stockGuardItems, updateWorkflowStepStatus,
} from './delivery.js';
import { stockAlert, missingStockItems } from './stock.js';
import { getCasePipelineStageId } from './cases.js';
import { validateNewPin } from './presentationLock.js';

const deal = { stockItems: [
  { id: 'a', name: '尾門', status: 'ready' }, { id: 'b', name: '帆布', status: 'inquiry' }, { id: 'c', name: '腳踏', status: 'not_needed' },
] };

test('stock guard lists unready accessories only for the install and delivery steps', () => {
  assert.deepEqual(stockGuardItems({ id: 'install-accessories' }, deal).map((i) => i.id), ['b']);
  assert.deepEqual(stockGuardItems({ id: 'delivery' }, deal).map((i) => i.id), ['b']);
  assert.deepEqual(stockGuardItems({ id: 'wash' }, deal), []);
  assert.deepEqual(stockGuardItems({ id: 'delivery' }, { stockItems: [{ status: 'installed' }] }), []);
  assert.equal(missingStockItems(null).length, 0);
});

test('delivery completion finishes the last step and marks leftovers as not applicable', () => {
  const flow = generateDeliveryWorkflow({ deal: { model: '尾門 帆布' } });
  const { workflow, skipped } = planDeliveryCompletion(flow, '2026-11-11T08:00:00.000Z');
  assert.equal(workflow.find((s) => s.id === 'delivery').status, 'done');
  assert.ok(workflow.every((s) => ['done', 'na'].includes(s.status)));
  assert.equal(skipped.length, flow.length - 1);
  const again = planDeliveryCompletion(workflow);
  assert.deepEqual(again.skipped, []);
  const done = flow.reduce((w, s) => updateWorkflowStepStatus(w, s.id, 'done'), flow);
  assert.deepEqual(planDeliveryCompletion(done).skipped, []);
});

test('delivery reminders match the customer-page record and never duplicate', () => {
  const client = { id: 'c1', name: '王先生' };
  let n = 0;
  const makeId = () => `t${n += 1}`;
  const annual = defaultAnnualReminders('2026-11-11');
  const first = buildDeliveryReminders({ client, date: '2026-11-11', annual, makeId });
  assert.equal(first.length, 6);
  assert.deepEqual(first.slice(0, 3).map((t) => t.note), ['交車後 3 天售後回訪', '交車後 7 天售後回訪', '交車後 30 天售後回訪']);
  assert.equal(buildDeliveryReminders({ client, date: '2026-11-11', annual, existingTimers: first, makeId }).length, 0);
  annual.replace.on = false;
  assert.equal(buildDeliveryReminders({ client, date: '2026-11-11', annual, makeId }).length, 5);
});

test('only pre-sale open items of the case are selected for closing', () => {
  const picked = selectPreSaleItemsToClose({
    caseId: 'k1', deal: { confirmedAt: '2026-11-05T00:00:00.000Z' },
    workItems: [
      { id: 'w1', caseId: 'k1', state: 'todo', createdAt: '2026-11-01T00:00:00.000Z' },
      { id: 'w2', caseId: 'k1', state: 'done', createdAt: '2026-11-01T00:00:00.000Z' },
      { id: 'w3', caseId: 'k1', state: 'todo', createdAt: '2026-11-09T00:00:00.000Z' },
      { id: 'w4', caseId: 'other', state: 'todo', createdAt: '2026-11-01T00:00:00.000Z' },
    ],
    tasks: [{ id: 't1', caseId: 'k1', done: false, createdAt: '2026-11-02T00:00:00.000Z' }],
    clients: [{ id: 'c1', todos: [{ id: 'd1', caseId: 'k1', done: false }, { id: 'd2', done: false }] }],
  });
  assert.deepEqual(picked.workItems, ['w1']);
  assert.deepEqual(picked.tasks, ['t1']);
  assert.deepEqual(picked.clientTodos, [{ clientId: 'c1', todoId: 'd1' }]);
});

test('a completed case with a deal stays completed and no longer warns about missing accessories', () => {
  const deals = [{ id: 'd1', caseId: 'k1', stockItems: deal.stockItems }];
  assert.equal(getCasePipelineStageId({ id: 'k1', status: 'completed' }, { deals }), 'completed');
  assert.equal(getCasePipelineStageId({ id: 'k1', status: 'active' }, { deals }), 'won');
  const alert = stockAlert(deals[0], { id: 'k1', status: 'completed', desiredDeliveryDate: '2026-11-12' }, new Date('2026-11-11'));
  assert.equal(alert.missing, 0);
  assert.equal(alert.deliveryRisk, false);
  assert.equal(stockAlert(deals[0], { id: 'k1', status: 'active' }).missing, 1);
});

test('new PIN needs 4-12 digits entered twice', () => {
  assert.equal(validateNewPin('2580', '2580'), '');
  assert.match(validateNewPin('12', '12'), /數字/);
  assert.match(validateNewPin('2580', '2581'), /不一樣/);
});

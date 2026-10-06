import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeliverySchedule, generateDeliveryWorkflow, getStageTiming, getWaitingOn,
  mergeSuggestedWorkflow, normalizeDeliveryWorkflow, updateWorkflowStepStatus,
} from './delivery.js';

test('delivery workflow keeps vendor contact parallel and construction in the requested order', () => {
    const workflow = generateDeliveryWorkflow({
      pricing: { lines: [{ name: '電動尾門＋帆布＋車身烤漆＋H架' }] },
    });
    const byId = new Map(workflow.map((step) => [step.id, step]));
    assert.equal(byId.get('contact-tailgate').dependsOn, 'contract');
    assert.equal(byId.get('contact-canvas').dependsOn, 'contract');
    assert.equal(byId.get('paint-body').dependsOn, 'install-tailgate');
    assert.equal(byId.get('install-canvas').dependsOn, 'paint-body');
    assert.equal(byId.get('install-body').dependsOn, 'install-canvas');
    assert.equal(byId.get('wash').dependsOn, 'install-body');
    assert.equal(byId.get('install-accessories').dependsOn, 'wash');
});

test('delivery workflow adds suggestions without duplicating existing work', () => {
    const current = [{ id: 'contract', label: '已建立' }];
    const merged = mergeSuggestedWorkflow(current, generateDeliveryWorkflow());
    assert.equal(merged.filter((step) => step.id === 'contract').length, 1);
    assert.equal(merged.some((step) => step.id === 'delivery'), true);
});

test('delivery workflow reports an unfinished predecessor', () => {
    const workflow = [{ id: 'a', label: '前一步', status: 'doing' }, { id: 'b', dependsOn: 'a' }];
    assert.equal(getWaitingOn(workflow[1], workflow)?.label, '前一步');
    workflow[0].status = 'done';
    assert.equal(getWaitingOn(workflow[1], workflow), null);
});

test('delivery workflow keeps legacy SOP data readable', () => {
    const workflow = normalizeDeliveryWorkflow({ deliverySop: { contract: { status: 'done', note: '完成' } } });
    assert.deepEqual(
      { id: workflow[0].id, status: workflow[0].status, note: workflow[0].note },
      { id: 'contract', status: 'done', note: '完成' },
    );
});

test('delivery schedule counts parallel stages once and follows the dependency path', () => {
    const workflow = generateDeliveryWorkflow({ pricing: { lines: [{ name: '尾門 帆布 烤漆' }] } });
    const schedule = buildDeliverySchedule(workflow);
    const tailgateContact = schedule.rows.find((step) => step.id === 'contact-tailgate');
    const canvasContact = schedule.rows.find((step) => step.id === 'contact-canvas');
    assert.equal(tailgateContact.startOffset, 1);
    assert.equal(canvasContact.startOffset, 1);
    assert.ok(schedule.totalDays < schedule.rows.reduce((total, step) => total + step.plannedDays, 0));
});

test('completing a stage activates the newly available next stage', () => {
    const start = '2026-10-06T01:00:00.000Z';
    const workflow = [
      { id: 'a', status: 'doing', activatedAt: start, plannedDays: 1 },
      { id: 'b', status: 'todo', dependsOn: 'a', activatedAt: null, plannedDays: 2 },
    ];
    const updated = updateWorkflowStepStatus(workflow, 'a', 'done', '2026-10-07T01:00:00.000Z');
    assert.equal(updated[0].completedAt, '2026-10-07T01:00:00.000Z');
    assert.equal(updated[1].activatedAt, '2026-10-07T01:00:00.000Z');
});

test('stage timing ignores waiting time and reports active overdue days', () => {
    const waiting = [
      { id: 'a', status: 'doing', activatedAt: '2026-10-01', plannedDays: 2 },
      { id: 'b', status: 'todo', dependsOn: 'a', activatedAt: null, plannedDays: 2 },
    ];
    assert.equal(getStageTiming(waiting[1], waiting, new Date('2026-10-10')).elapsedDays, null);
    const timing = getStageTiming(waiting[0], waiting, new Date('2026-10-04'));
    assert.equal(timing.elapsedDays, 4);
    assert.equal(timing.overDays, 2);
    assert.equal(timing.urgency, 'overdue');
});

test('normalization preserves stage planning and timing fields', () => {
    const workflow = normalizeDeliveryWorkflow({ deliveryWorkflow: [{
      id: 'paint-body', label: '烤漆', status: 'done', plannedDays: 5,
      activatedAt: '2026-10-01', completedAt: '2026-10-04', statusChangedAt: '2026-10-04',
    }] });
    assert.deepEqual(
      { plannedDays: workflow[0].plannedDays, activatedAt: workflow[0].activatedAt, completedAt: workflow[0].completedAt },
      { plannedDays: 5, activatedAt: '2026-10-01', completedAt: '2026-10-04' },
    );
});

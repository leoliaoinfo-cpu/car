import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeliverySchedule, createWorkflowRestorePoint, findWorkflowCycleIds, generateDeliveryWorkflow,
  getCurrentWorkflowStep, getStageTiming, getWaitingOn, mergeSuggestedWorkflow, normalizeDeliveryWorkflow,
  planWorkflowStatusChange, reorderWorkflow, restoreWorkflowChange, updateWorkflowStepStatus, wouldCreateCycle,
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

test('status confirmation preview reports every parallel step it will unlock without mutating source', () => {
  const workflow = [
    { id: 'contract', label: '確認內容', status: 'doing', activatedAt: '2026-10-07', plannedDays: 1 },
    { id: 'tailgate', label: '聯繫尾門', status: 'todo', dependsOn: 'contract', activatedAt: null, plannedDays: 2 },
    { id: 'canvas', label: '聯繫帆布', status: 'todo', dependsOn: 'contract', activatedAt: null, plannedDays: 2 },
  ];
  const plan = planWorkflowStatusChange(workflow, 'contract', 'done', '2026-10-08T01:00:00.000Z');
  assert.deepEqual(plan.newlyAvailable.map((step) => step.id), ['tailgate', 'canvas']);
  assert.equal(plan.nextWorkflow[0].status, 'done');
  assert.equal(plan.nextWorkflow[1].activatedAt, '2026-10-08T01:00:00.000Z');
  assert.equal(workflow[0].status, 'doing');
  assert.equal(workflow[1].activatedAt, null);
});

test('status restore only reverts the status operation and keeps later notes costs and supplier edits', () => {
  const before = [
    { id: 'contract', status: 'doing', completedAt: null, statusChangedAt: 'old', note: '', cost: '', supplierId: '' },
    { id: 'tailgate', status: 'todo', dependsOn: 'contract', activatedAt: null, note: '' },
  ];
  const after = updateWorkflowStepStatus(before, 'contract', 'done', '2026-10-08T01:00:00.000Z');
  const restorePoint = createWorkflowRestorePoint(before, after);
  const later = after.map((step) => step.id === 'contract'
    ? { ...step, note: '稍後新增的備註', cost: '12000', supplierId: 'vendor-1' }
    : { ...step, note: '已通知廠商' });
  const restored = restoreWorkflowChange(later, restorePoint);
  assert.equal(restored[0].status, 'doing');
  assert.equal(restored[0].completedAt, null);
  assert.equal(restored[0].note, '稍後新增的備註');
  assert.equal(restored[0].cost, '12000');
  assert.equal(restored[0].supplierId, 'vendor-1');
  assert.equal(restored[1].activatedAt, null);
  assert.equal(restored[1].note, '已通知廠商');
});

test('delete restore reinserts the deleted step and restores only affected dependencies', () => {
  const before = [
    { id: 'a', label: 'A', status: 'done' },
    { id: 'b', label: 'B', status: 'doing', dependsOn: 'a', note: '' },
    { id: 'c', label: 'C', status: 'todo', dependsOn: 'b', note: '' },
  ];
  const after = before
    .filter((step) => step.id !== 'b')
    .map((step) => step.dependsOn === 'b' ? { ...step, dependsOn: null } : step);
  const restorePoint = createWorkflowRestorePoint(before, after);
  const later = after.map((step) => step.id === 'c' ? { ...step, note: '刪除後新增的備註' } : step);
  const restored = restoreWorkflowChange(later, restorePoint);
  assert.deepEqual(restored.map((step) => step.id), ['a', 'b', 'c']);
  assert.equal(restored[2].dependsOn, 'b');
  assert.equal(restored[2].note, '刪除後新增的備註');
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

test('drag sorting moves one stage without losing stage data or dependencies', () => {
  const workflow = [
    { id: 'a', label: 'A', dependsOn: null },
    { id: 'b', label: 'B', dependsOn: 'a' },
    { id: 'c', label: 'C', dependsOn: 'b' },
  ];
  const reordered = reorderWorkflow(workflow, 'c', 'a');
  assert.deepEqual(reordered.map((step) => step.id), ['c', 'a', 'b']);
  assert.deepEqual(
    Object.fromEntries(reordered.map((step) => [step.id, step.dependsOn])),
    Object.fromEntries(workflow.map((step) => [step.id, step.dependsOn])),
  );
  const reloaded = normalizeDeliveryWorkflow({ deliveryWorkflow: JSON.parse(JSON.stringify(reordered)) });
  assert.deepEqual(reloaded.map((step) => step.id), ['c', 'a', 'b']);
  assert.deepEqual(
    Object.fromEntries(reloaded.map((step) => [step.id, step.dependsOn])),
    Object.fromEntries(workflow.map((step) => [step.id, step.dependsOn])),
  );
});

test('dependency validation blocks direct and indirect cycles', () => {
  const workflow = [
    { id: 'a', dependsOn: null },
    { id: 'b', dependsOn: 'a' },
    { id: 'c', dependsOn: 'b' },
  ];
  assert.equal(wouldCreateCycle(workflow, 'a', 'a'), true);
  assert.equal(wouldCreateCycle(workflow, 'a', 'b'), true);
  assert.equal(wouldCreateCycle(workflow, 'a', 'c'), true);
  assert.equal(wouldCreateCycle(workflow, 'c', 'a'), false);
  const existingCycle = [{ id: 'a', dependsOn: 'b' }, { id: 'b', dependsOn: 'a' }, { id: 'c', dependsOn: 'b' }];
  assert.deepEqual([...findWorkflowCycleIds(existingCycle)].sort(), ['a', 'b']);
});

test('sorting parallel vendor contacts keeps their schedule offsets unchanged', () => {
  const workflow = generateDeliveryWorkflow({ pricing: { lines: [{ name: '尾門 帆布' }] } });
  const before = new Map(buildDeliverySchedule(workflow).rows.map((step) => [step.id, step.startOffset]));
  const reordered = reorderWorkflow(workflow, 'contact-canvas', 'contact-tailgate');
  const after = new Map(buildDeliverySchedule(reordered).rows.map((step) => [step.id, step.startOffset]));
  assert.equal(after.get('contact-tailgate'), before.get('contact-tailgate'));
  assert.equal(after.get('contact-canvas'), before.get('contact-canvas'));
});

test('current workflow step is independent from display order', () => {
  const workflow = [
    { id: 'contract', status: 'done', dependsOn: null, plannedDays: 1 },
    { id: 'contact-tailgate', status: 'doing', dependsOn: 'contract', plannedDays: 2, activatedAt: '2026-10-07' },
    { id: 'contact-canvas', status: 'todo', dependsOn: 'contract', plannedDays: 2, activatedAt: '2026-10-07' },
    { id: 'install-tailgate', status: 'todo', dependsOn: 'contact-tailgate', plannedDays: 3 },
  ];
  const reordered = reorderWorkflow(workflow, 'contact-canvas', 'contract');
  assert.equal(getCurrentWorkflowStep(workflow)?.id, 'contact-tailgate');
  assert.equal(getCurrentWorkflowStep(reordered)?.id, 'contact-tailgate');
});

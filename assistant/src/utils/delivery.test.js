import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignWorkflowOrderToDependencies, buildDeliverySchedule, createWorkflowRestorePoint, findWorkflowCycleIds, generateDeliveryWorkflow,
  getCurrentWorkflowStep, getStageTiming, getWaitingOn, mergeSuggestedWorkflow, normalizeDeliveryWorkflow,
  planWorkflowStatusChange, reorderWorkflow, restoreWorkflowChange, updateWorkflowStepStatus, wouldCreateCycle, isVendorContactStep,
} from './delivery.js';

test('changing a predecessor aligns the visual order while preserving parallel work order', () => {
  const workflow = [
    { id: 'contract', label: '簽約', dependsOn: null },
    { id: 'canvas', label: '帆布', dependsOn: 'contract' },
    { id: 'wash', label: '洗車', dependsOn: 'paint' },
    { id: 'tailgate', label: '尾門', dependsOn: 'contract' },
    { id: 'paint', label: '烤漆', dependsOn: 'tailgate' },
    { id: 'delivery', label: '交車', dependsOn: 'wash' },
  ];
  const ordered = alignWorkflowOrderToDependencies(workflow);
  assert.deepEqual(ordered.map((step) => step.id), ['contract', 'canvas', 'tailgate', 'paint', 'wash', 'delivery']);
  assert.deepEqual(workflow.map((step) => step.id), ['contract', 'canvas', 'wash', 'tailgate', 'paint', 'delivery']);
});

test('dependency alignment keeps existing cycles intact for manual correction', () => {
  const workflow = [
    { id: 'free', dependsOn: null },
    { id: 'a', dependsOn: 'b' },
    { id: 'b', dependsOn: 'a' },
  ];
  assert.deepEqual(alignWorkflowOrderToDependencies(workflow).map((step) => step.id), ['free', 'a', 'b']);
});

test('delivery workflow no longer has vendor-contact steps (they live in the stock checklist) and keeps construction order', () => {
    const workflow = generateDeliveryWorkflow({
      pricing: { lines: [{ name: '電動尾門＋帆布＋車身烤漆＋H架' }] },
    });
    const byId = new Map(workflow.map((step) => [step.id, step]));
    assert.equal(workflow.some((step) => isVendorContactStep(step)), false);
    assert.equal(byId.get('install-tailgate').dependsOn, 'contract');
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
    const workflow = [
      { id: 'contract', label: '簽約', status: 'todo', plannedDays: 1 },
      { id: 'contact-tailgate', label: '聯繫尾門廠商', status: 'doing', dependsOn: 'contract', plannedDays: 2 },
      { id: 'contact-canvas', label: '聯繫帆布廠商', status: 'doing', dependsOn: 'contract', plannedDays: 2 },
      { id: 'delivery', label: '交車', status: 'todo', dependsOn: 'contact-canvas', plannedDays: 1 },
    ];
    const schedule = buildDeliverySchedule(workflow);
    const tailgateContact = schedule.rows.find((step) => step.id === 'contact-tailgate');
    const canvasContact = schedule.rows.find((step) => step.id === 'contact-canvas');
    assert.equal(tailgateContact.startOffset, 1);
    assert.equal(canvasContact.startOffset, 1);
    assert.ok(schedule.totalDays < schedule.rows.reduce((total, step) => total + step.plannedDays, 0));
});

test('old deals: untouched vendor-contact steps are dropped on read and dependents re-linked; touched ones are kept', () => {
    const old = {
      deliveryWorkflow: [
        { id: 'contract', label: '簽約', status: 'done', plannedDays: 1, activatedAt: '2026-11-01', completedAt: '2026-11-02' },
        { id: 'contact-tailgate', label: '聯繫尾門廠商', status: 'todo', dependsOn: 'contract' },
        { id: 'contact-canvas', label: '聯繫帆布廠商', status: 'contacted', dependsOn: 'contract' },
        { id: 'contact-paint', label: '聯繫烤漆廠商', status: 'todo', dependsOn: 'contract', note: '黑色' },
        { id: 'install-tailgate', label: '牽車安裝尾門', status: 'todo', dependsOn: 'contact-tailgate' },
        { id: 'install-canvas', label: '安裝帆布', status: 'todo', dependsOn: 'contact-canvas' },
      ],
    };
    const flow = normalizeDeliveryWorkflow(old);
    const ids = flow.map((step) => step.id);
    assert.deepEqual(ids, ['contract', 'contact-canvas', 'contact-paint', 'install-tailgate', 'install-canvas']);
    assert.equal(flow.find((step) => step.id === 'install-tailgate').dependsOn, 'contract');
    assert.equal(flow.find((step) => step.id === 'install-canvas').dependsOn, 'contact-canvas');
    assert.equal(old.deliveryWorkflow.length, 6); // 原資料不動
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
      blockedReason: '等待色號', blockedOwner: '烤漆廠', blockedFollowUpDate: '2026-10-03',
    }] });
    assert.deepEqual(
      {
        plannedDays: workflow[0].plannedDays, activatedAt: workflow[0].activatedAt, completedAt: workflow[0].completedAt,
        blockedReason: workflow[0].blockedReason, blockedOwner: workflow[0].blockedOwner, blockedFollowUpDate: workflow[0].blockedFollowUpDate,
      },
      {
        plannedDays: 5, activatedAt: '2026-10-01', completedAt: '2026-10-04',
        blockedReason: '等待色號', blockedOwner: '烤漆廠', blockedFollowUpDate: '2026-10-03',
      },
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

test('報價上的資訊與備註帶到對應的施工步驟（尾門／帆布／烤漆／H架／領牌／簽約），只讀取', async () => {
  const { quoteNotesForSteps } = await import('./delivery.js');
  const deal = { quoteSnapshot: { requirements: '市場載貨', note: '選牌7275，交車一起處理', items: [
    { id: 'v', kind: 'vehicle', name: '車輛售價', note: '領牌人 莊天旗' },
    { id: 'c', kind: 'other', name: '五面帆160CM +蓬頂(帆布往內鎖)' },
    { id: 'p', kind: 'addon', name: '車身烤漆改色', note: '冰川水泥灰' },
    { id: 'f', kind: 'other', name: '領牌費', note: '交車時收' },
    { id: 'a', kind: 'addon', name: '尿素桶防撞桿', note: '橘色' },
  ] } };
  const notes = quoteNotesForSteps(deal);
  assert.equal(notes['install-canvas'], '五面帆160CM +蓬頂(帆布往內鎖)');
  assert.equal(notes['paint-body'], '車身烤漆改色：冰川水泥灰');
  assert.equal(notes.inspection, '領牌費：交車時收');
  assert.equal(notes['install-accessories'], '尿素桶防撞桿：橘色');
  assert.match(notes.contract, /需求：市場載貨.*備註：選牌7275.*車輛售價：領牌人 莊天旗/);
  assert.deepEqual(quoteNotesForSteps({}), {});
});

test('施工步驟的廠商先後順序：一般 橡膠墊 → 帆布；有升降帆布 升降帆布 → 橡膠墊 → 帆布', () => {
  const ids = (names) => generateDeliveryWorkflow({ pricing: { lines: names.map((name) => ({ name })) } }).map((step) => step.id);
  const normal = ids(['貨斗橡膠墊－只鋪底面（雙廂）', '三面帆布－雙廂標準高']);
  assert.ok(normal.indexOf('install-rubber') < normal.indexOf('install-canvas'));
  assert.equal(normal.includes('install-lift-canvas'), false);
  const lift = ids(['貨斗橡膠墊－全封（單廂）', '升降帆布', '三面帆布－單廂標準高']);
  assert.ok(lift.indexOf('install-lift-canvas') < lift.indexOf('install-rubber'));
  assert.ok(lift.indexOf('install-rubber') < lift.indexOf('install-canvas'));
  // 只有升降帆布：不會多出一般帆布步驟
  const only = ids(['升降帆布']);
  assert.ok(only.includes('install-lift-canvas'));
  assert.equal(only.includes('install-canvas'), false);
  const flow = generateDeliveryWorkflow({ pricing: { lines: [{ name: '貨斗橡膠墊－只鋪底面（雙廂）' }, { name: '三面帆布－雙廂標準高' }] } });
  assert.equal(flow.find((step) => step.id === 'install-canvas').dependsOn, 'install-rubber');
});

test('施工順序含貼紙刻字：配件安裝→貼紙→驗車與變更', async () => {
  const { generateDeliveryWorkflow } = await import('./delivery.js');
  const ids = generateDeliveryWorkflow({ deal: {}, pricing: { lines: [{ name: '電動尾門' }, { name: '車體烤漆' }, { name: '三面帆布' }, { name: '車身貼紙刻字' }] } }).map((s) => s.id);
  assert.deepEqual(ids.filter((id) => ['install-tailgate', 'paint-body', 'install-canvas', 'install-accessories', 'install-sticker', 'inspection'].includes(id)),
    ['install-tailgate', 'paint-body', 'install-canvas', 'install-accessories', 'install-sticker', 'inspection']);
});

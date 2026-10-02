import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDeliveryWorkflow, getWaitingOn, mergeSuggestedWorkflow, normalizeDeliveryWorkflow } from './delivery.js';

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

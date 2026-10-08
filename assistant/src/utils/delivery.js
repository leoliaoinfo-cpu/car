const STATUS_VALUES = new Set(['todo', 'contacted', 'scheduled', 'doing', 'blocked', 'done', 'na']);
const FINISHED_STATUSES = new Set(['done', 'na']);

export const DELIVERY_DEFAULT_DAYS = {
  contract: 1,
  'contact-tailgate': 2,
  'contact-canvas': 2,
  'contact-paint': 2,
  'contact-body': 2,
  'install-tailgate': 3,
  'paint-body': 3,
  'install-canvas': 2,
  'install-body': 2,
  wash: 1,
  'install-accessories': 1,
  inspection: 1,
  delivery: 1,
};

export const DELIVERY_STATUS_OPTIONS = [
  ['todo', '待聯繫'],
  ['contacted', '已聯繫'],
  ['scheduled', '已排程'],
  ['doing', '施工中'],
  ['blocked', '卡住'],
  ['done', '已完成'],
  ['na', '不適用'],
];

const LEGACY_LABELS = {
  contract: '簽約資料確認', supplier: '比較並指派配件供應商', orders: '配件訂貨與廠商進度確認',
  tailgate: '升降尾門施作與完工確認', paint: '車身噴漆與外觀確認', plate: '驗車與領牌',
  install: '其餘改裝配件安裝確認', delivery: '交車前驗收與交車',
};

const LEGACY_IDS = {
  contract: 'contract', supplier: 'supplier', orders: 'orders', tailgate: 'install-tailgate',
  paint: 'paint-body', plate: 'inspection', install: 'install-accessories', delivery: 'delivery',
};

function workflowStep(id, label, service, dependsOn = null) {
  return {
    id, label, service, dependsOn, status: 'todo', supplierId: '', plannedDate: '', cost: '', note: '',
    plannedDays: DELIVERY_DEFAULT_DAYS[id] || 1, activatedAt: null, completedAt: null, statusChangedAt: null,
  };
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

export function generateDeliveryWorkflow({ deal = {}, pricing = null } = {}) {
  const source = [
    deal.model, deal.note,
    ...(pricing?.lines || []).flatMap((line) => [line.name, line.description, line.note]),
  ].filter(Boolean).join(' ');
  const hasTailgate = includesAny(source, ['尾門', '升降門']);
  const hasCanvas = includesAny(source, ['帆布']);
  const hasPaint = includesAny(source, ['烤漆', '噴漆', '改色', '車色']);
  const hasRackOrBody = includesAny(source, ['H架', 'Ｈ架', '箱體', '廂體']);

  const steps = [workflowStep('contract', '簽約與施工內容確認', '行政')];
  if (hasTailgate) steps.push(workflowStep('contact-tailgate', '聯繫尾門廠商', '尾門', 'contract'));
  if (hasCanvas) steps.push(workflowStep('contact-canvas', '聯繫帆布廠商', '帆布', 'contract'));
  if (hasPaint) steps.push(workflowStep('contact-paint', '聯繫烤漆廠商', '烤漆', 'contract'));
  if (hasRackOrBody) steps.push(workflowStep('contact-body', '聯繫 H 架／箱體廠商', 'H架／箱體', 'contract'));

  let previous = 'contract';
  if (hasTailgate) {
    steps.push(workflowStep('install-tailgate', '牽車安裝尾門', '尾門', 'contact-tailgate'));
    previous = 'install-tailgate';
  }
  if (hasPaint) {
    steps.push(workflowStep('paint-body', '車體烤漆與外觀確認', '烤漆', previous === 'contract' ? 'contact-paint' : previous));
    previous = 'paint-body';
  }
  if (hasCanvas) {
    steps.push(workflowStep('install-canvas', '安裝帆布', '帆布', previous === 'contract' ? 'contact-canvas' : previous));
    previous = 'install-canvas';
  }
  if (hasRackOrBody) {
    steps.push(workflowStep('install-body', '安裝 H 架／箱體', 'H架／箱體', previous === 'contract' ? 'contact-body' : previous));
    previous = 'install-body';
  }
  steps.push(workflowStep('wash', '車輛清洗', '洗車', previous));
  steps.push(workflowStep('install-accessories', '改裝配件安裝與功能確認', '配件安裝', 'wash'));
  steps.push(workflowStep('inspection', '完工驗收與領牌確認', '驗車', 'install-accessories'));
  steps.push(workflowStep('delivery', '交車前確認與正式交車', '交車', 'inspection'));
  return activateAvailableWorkflowSteps(steps);
}

export function normalizeDeliveryWorkflow(deal = {}) {
  if (Array.isArray(deal.deliveryWorkflow) && deal.deliveryWorkflow.length) {
    const normalized = deal.deliveryWorkflow.map((step, index) => ({
      id: step.id || `step-${index + 1}`,
      label: step.label || `工作 ${index + 1}`,
      service: step.service || '其他',
      dependsOn: step.dependsOn || null,
      status: STATUS_VALUES.has(step.status) ? step.status : 'todo',
      supplierId: step.supplierId || '', plannedDate: step.plannedDate || '', cost: step.cost ?? '',
      note: step.note || '', updatedAt: step.updatedAt || null,
      plannedDays: Math.max(1, Number(step.plannedDays) || DELIVERY_DEFAULT_DAYS[step.id] || 1),
      activatedAt: step.activatedAt || null, completedAt: step.completedAt || null,
      statusChangedAt: step.statusChangedAt || step.updatedAt || null,
    }));
    return activateAvailableWorkflowSteps(normalized);
  }
  if (deal.deliverySop && typeof deal.deliverySop === 'object') {
    const legacy = Object.entries(LEGACY_LABELS).map(([id, label], index) => {
      const previous = deal.deliverySop[id] || {};
      return {
        ...workflowStep(LEGACY_IDS[id], label, '其他', index ? LEGACY_IDS[Object.keys(LEGACY_LABELS)[index - 1]] : null),
        status: STATUS_VALUES.has(previous.status) ? previous.status : 'todo',
        note: previous.note || '', updatedAt: previous.updatedAt || null,
        plannedDays: DELIVERY_DEFAULT_DAYS[LEGACY_IDS[id]] || 1,
        activatedAt: previous.activatedAt || null, completedAt: previous.completedAt || null,
        statusChangedAt: previous.statusChangedAt || previous.updatedAt || null,
      };
    });
    return activateAvailableWorkflowSteps(legacy);
  }
  return [];
}

export function mergeSuggestedWorkflow(current, suggested) {
  const existing = new Set((current || []).map((step) => step.id));
  return [...(current || []), ...(suggested || []).filter((step) => !existing.has(step.id))];
}

export function reorderWorkflow(workflow, draggedId, targetId) {
  const source = [...(workflow || [])];
  const from = source.findIndex((step) => step.id === draggedId);
  const to = source.findIndex((step) => step.id === targetId);
  if (from < 0 || to < 0 || from === to) return source;
  const [moved] = source.splice(from, 1);
  source.splice(to, 0, moved);
  return source;
}

/** 建立精準復原點：只記錄這次操作真正改動的欄位、增刪步驟與原位置。 */
export function createWorkflowRestorePoint(beforeWorkflow, afterWorkflow) {
  const before = beforeWorkflow || [];
  const after = afterWorkflow || [];
  const beforeById = new Map(before.map((step) => [step.id, step]));
  const afterById = new Map(after.map((step) => [step.id, step]));
  const patches = {};
  for (const [id, previous] of beforeById) {
    const next = afterById.get(id);
    if (!next) continue;
    const patch = {};
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (!Object.is(previous[key], next[key])) patch[key] = previous[key];
    }
    if (Object.keys(patch).length) patches[id] = patch;
  }
  return {
    patches,
    removedSteps: before
      .map((step, index) => ({ step: { ...step }, index }))
      .filter(({ step }) => !afterById.has(step.id)),
    addedStepIds: after.filter((step) => !beforeById.has(step.id)).map((step) => step.id),
  };
}

/** 套用精準復原點；保留該次操作之後新增的備註、成本、廠商與其他無關欄位。 */
export function restoreWorkflowChange(currentWorkflow, restorePoint) {
  const point = restorePoint || {};
  const added = new Set(point.addedStepIds || []);
  let restored = (currentWorkflow || [])
    .filter((step) => !added.has(step.id))
    .map((step) => point.patches?.[step.id] ? { ...step, ...point.patches[step.id] } : { ...step });
  for (const removed of [...(point.removedSteps || [])].sort((a, b) => a.index - b.index)) {
    if (restored.some((step) => step.id === removed.step.id)) continue;
    restored.splice(Math.min(Math.max(0, removed.index), restored.length), 0, { ...removed.step });
  }
  return restored;
}

/** 判斷把 stepId 的前置工作改成 newDependsOnId 是否會形成循環。 */
export function wouldCreateCycle(workflow, stepId, newDependsOnId) {
  if (!newDependsOnId) return false;
  if (stepId === newDependsOnId) return true;
  const byId = new Map((workflow || []).map((step) => [step.id, step]));
  const visited = new Set();
  let currentId = newDependsOnId;
  while (currentId && !visited.has(currentId)) {
    if (currentId === stepId) return true;
    visited.add(currentId);
    currentId = byId.get(currentId)?.dependsOn || null;
  }
  return false;
}

/** 回傳既有資料中真正位於循環內的步驟 id；只讀取、不修正資料。 */
export function findWorkflowCycleIds(workflow) {
  const byId = new Map((workflow || []).map((step) => [step.id, step]));
  const cycleIds = new Set();
  for (const start of workflow || []) {
    const path = [];
    const position = new Map();
    let currentId = start.id;
    while (currentId && byId.has(currentId)) {
      if (position.has(currentId)) {
        path.slice(position.get(currentId)).forEach((id) => cycleIds.add(id));
        break;
      }
      position.set(currentId, path.length);
      path.push(currentId);
      currentId = byId.get(currentId)?.dependsOn || null;
    }
  }
  return cycleIds;
}

export function getWaitingOn(step, workflow) {
  if (!step?.dependsOn) return null;
  const dependency = (workflow || []).find((candidate) => candidate.id === step.dependsOn);
  if (!dependency || FINISHED_STATUSES.has(dependency.status)) return null;
  return dependency;
}

function isoTime(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return value;
  return new Date().toISOString();
}

function dayNumber(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

export function activateAvailableWorkflowSteps(workflow, at = new Date().toISOString()) {
  const timestamp = isoTime(at);
  const source = (workflow || []).map((step) => ({ ...step }));
  return source.map((step) => {
    if (FINISHED_STATUSES.has(step.status)) return step;
    const waiting = getWaitingOn(step, source);
    if (waiting && step.status === 'todo') return { ...step, activatedAt: null };
    if (!waiting && !step.activatedAt) {
      return { ...step, activatedAt: timestamp, statusChangedAt: step.statusChangedAt || timestamp };
    }
    return step;
  });
}

export function updateWorkflowStepStatus(workflow, stepId, status, at = new Date().toISOString()) {
  const timestamp = isoTime(at);
  const next = (workflow || []).map((step) => {
    if (step.id !== stepId) return { ...step };
    const finished = FINISHED_STATUSES.has(status);
    return {
      ...step,
      status,
      statusChangedAt: timestamp,
      updatedAt: timestamp,
      activatedAt: step.activatedAt || timestamp,
      completedAt: finished ? timestamp : null,
    };
  });
  return activateAvailableWorkflowSteps(next, timestamp);
}

/**
 * 規劃一次狀態變更，讓畫面能在真正存檔前顯示影響範圍。
 * 純函式：不會改動傳入的 workflow。
 */
export function planWorkflowStatusChange(workflow, stepId, status, at = new Date().toISOString()) {
  const beforeWorkflow = (workflow || []).map((step) => ({ ...step }));
  const step = beforeWorkflow.find((candidate) => candidate.id === stepId) || null;
  if (!step || step.status === status) {
    return { beforeWorkflow, nextWorkflow: beforeWorkflow, step, newlyAvailable: [] };
  }
  const waitingBefore = new Set(beforeWorkflow
    .filter((candidate) => getWaitingOn(candidate, beforeWorkflow))
    .map((candidate) => candidate.id));
  const nextWorkflow = updateWorkflowStepStatus(beforeWorkflow, stepId, status, at);
  const newlyAvailable = nextWorkflow.filter((candidate) => (
    waitingBefore.has(candidate.id)
    && !getWaitingOn(candidate, nextWorkflow)
    && !FINISHED_STATUSES.has(candidate.status)
  ));
  return { beforeWorkflow, nextWorkflow, step, newlyAvailable };
}

export function getStageTiming(step, workflow, now = new Date()) {
  const plannedDays = Math.max(1, Number(step?.plannedDays) || DELIVERY_DEFAULT_DAYS[step?.id] || 1);
  if (!step || getWaitingOn(step, workflow) || !step.activatedAt) {
    return { plannedDays, elapsedDays: null, overDays: 0, ratio: 0, urgency: 'waiting' };
  }
  const start = dayNumber(step.activatedAt);
  const end = dayNumber(step.completedAt || now);
  const elapsedDays = start == null || end == null ? null : Math.max(1, end - start + 1);
  const overDays = elapsedDays == null ? 0 : Math.max(0, elapsedDays - plannedDays);
  const ratio = elapsedDays == null ? 0 : elapsedDays / plannedDays;
  return {
    plannedDays,
    elapsedDays,
    overDays,
    ratio,
    urgency: overDays > 0 ? 'overdue' : ratio >= 0.8 ? 'warning' : 'normal',
  };
}

export function buildDeliverySchedule(workflow) {
  const source = workflow || [];
  const byId = new Map(source.map((step) => [step.id, step]));
  const memo = new Map();
  const visiting = new Set();

  function offset(step) {
    if (memo.has(step.id)) return memo.get(step.id);
    if (visiting.has(step.id)) return 0;
    visiting.add(step.id);
    const dependency = step.dependsOn ? byId.get(step.dependsOn) : null;
    const start = dependency ? offset(dependency) + Math.max(1, Number(dependency.plannedDays) || DELIVERY_DEFAULT_DAYS[dependency.id] || 1) : 0;
    visiting.delete(step.id);
    memo.set(step.id, start);
    return start;
  }

  const rows = source.map((step) => {
    const plannedDays = Math.max(1, Number(step.plannedDays) || DELIVERY_DEFAULT_DAYS[step.id] || 1);
    const startOffset = offset(step);
    return { ...step, plannedDays, startOffset, endOffset: startOffset + plannedDays };
  });
  return { rows, totalDays: Math.max(0, ...rows.map((row) => row.endOffset)) };
}

/**
 * 目前工作依施工邏輯判定，不依畫面陣列順序：
 * 1. 優先選沒有未完成前置工作的階段；若循環使全部都在等待，才從全部未完成階段選擇。
 * 2. 排程起點較早者優先。
 * 3. 已在進行中的狀態優先，再以預計日、啟用時間與固定 id 決勝。
 */
export function getCurrentWorkflowStep(workflow) {
  const source = workflow || [];
  const unfinished = source.filter((step) => !FINISHED_STATUSES.has(step.status));
  if (!unfinished.length) return null;
  const available = unfinished.filter((step) => !getWaitingOn(step, source));
  const candidates = available.length ? available : unfinished;
  const offsets = new Map(buildDeliverySchedule(source).rows.map((step) => [step.id, step.startOffset]));
  const statusRank = new Map([
    ['doing', 0], ['scheduled', 1], ['contacted', 2], ['blocked', 3], ['todo', 4],
  ]);
  return [...candidates].sort((a, b) => (
    (offsets.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (offsets.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    || (statusRank.get(a.status) ?? 9) - (statusRank.get(b.status) ?? 9)
    || String(a.plannedDate || '9999-12-31').localeCompare(String(b.plannedDate || '9999-12-31'))
    || String(a.activatedAt || '9999-12-31').localeCompare(String(b.activatedAt || '9999-12-31'))
    || String(a.id).localeCompare(String(b.id))
  ))[0];
}


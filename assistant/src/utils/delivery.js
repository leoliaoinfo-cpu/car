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


import dayjs from 'dayjs';
import { getStageTiming, getWaitingOn, normalizeDeliveryWorkflow } from './delivery.js';

export const CASE_TYPE_LABEL = { purchase: '買車', modification: '改裝' };
export const CASE_STATUS_LABEL = { active: '進行中', waiting: '等待中', completed: '已完成' };
export const FIRST_CASE_NUMBER = 100;
export const CASE_PIPELINE_STAGES = [
  { id: 'new', label: '新開發（報價）' },
  { id: 'follow_up', label: '有意願在追蹤' },
  { id: 'won', label: '已成交' },
  { id: 'delivery', label: '安排交車事項' },
  { id: 'completed', label: '已完工交車' },
];

export function getCasePipelineStageId(item, { deals = [], quotes = [] } = {}) {
  const normalizedExplicit = item?.pipelineStage === 'quoted' ? 'new' : item?.pipelineStage;
  const explicit = CASE_PIPELINE_STAGES.findIndex((stage) => stage.id === normalizedExplicit);
  let derived = item?.status === 'completed' ? 4 : 0;
  const linkedDeal = deals.find((row) => row.id === item?.dealId || row.caseId === item?.id);
  if (linkedDeal) derived = 2;
  return CASE_PIPELINE_STAGES[Math.max(explicit, derived, 0)].id;
}

export function assignCaseNumbers(items = [], nextNumber = FIRST_CASE_NUMBER) {
  const ordered = [...items].sort((a, b) => String(a.createdAt || a.updatedAt || a.id || '').localeCompare(String(b.createdAt || b.updatedAt || b.id || '')));
  const used = new Set();
  let cursor = Math.max(FIRST_CASE_NUMBER, Number.isInteger(Number(nextNumber)) ? Number(nextNumber) : FIRST_CASE_NUMBER);
  const byId = new Map();
  const changedIds = [];

  for (const item of ordered) {
    const requested = Number(item.caseNumber);
    let caseNumber = Number.isInteger(requested) && requested >= FIRST_CASE_NUMBER && !used.has(requested) ? requested : null;
    if (caseNumber == null) {
      while (used.has(cursor)) cursor += 1;
      caseNumber = cursor;
      cursor += 1;
    }
    used.add(caseNumber);
    cursor = Math.max(cursor, caseNumber + 1);
    const next = caseNumber === item.caseNumber ? item : { ...item, caseNumber };
    if (next !== item) changedIds.push(item.id);
    byId.set(item.id, next);
  }

  return {
    cases: items.map((item) => byId.get(item.id) || item),
    nextNumber: cursor,
    changedIds,
  };
}

export function getCaseStatusLabel(item) {
  return String(item?.stageLabel || '').trim() || CASE_STATUS_LABEL[item?.status] || '進行中';
}

export function getCasePipelineStage(item, { deals = [], quotes = [] } = {}) {
  const id = getCasePipelineStageId(item, { deals, quotes });
  return CASE_PIPELINE_STAGES.find((stage) => stage.id === id)?.label || '新開發';
}

/**
 * 案件階段最後異動時間。
 * 新資料使用 pipelineStageUpdatedAt；舊資料則從實際促成階段變化的報價／成交時間補足，
 * 最後才退回案件本身的更新或建立時間，避免改備註也被誤認成狀態更新。
 */
export function getCasePipelineUpdatedAt(item, { deals = [], quotes = [] } = {}) {
  if (!item) return '';
  const stageId = getCasePipelineStageId(item, { deals, quotes });
  const stageIndex = CASE_PIPELINE_STAGES.findIndex((stage) => stage.id === stageId);
  const explicitStage = item.pipelineStage === 'quoted' ? 'new' : item.pipelineStage;
  if (explicitStage === stageId && item.pipelineStageUpdatedAt && dayjs(item.pipelineStageUpdatedAt).isValid()) {
    return item.pipelineStageUpdatedAt;
  }
  const candidates = [item.pipelineStageUpdatedAt].filter(Boolean);

  if (stageId === 'new') {
    const quoteIds = new Set(item.quoteIds || []);
    quotes
      .filter((row) => row.caseId === item.id || quoteIds.has(row.id))
      .forEach((row) => candidates.push(row.createdAt || row.date || row.updatedAt));
  }
  if (stageIndex >= 2) {
    deals
      .filter((row) => row.caseId === item.id || row.id === item.dealId)
      .forEach((row) => candidates.push(row.createdAt || row.date || row.updatedAt));
  }

  const valid = candidates.filter((value) => value && dayjs(value).isValid());
  if (valid.length) return valid.sort((a, b) => dayjs(a).valueOf() - dayjs(b).valueOf()).at(-1);
  return item.updatedAt || item.createdAt || '';
}

export function getCasePipelineElapsedDays(item, options = {}, now = new Date()) {
  const enteredAt = getCasePipelineUpdatedAt(item, options);
  if (!enteredAt || !dayjs(enteredAt).isValid()) return null;
  return Math.max(1, dayjs(now).startOf('day').diff(dayjs(enteredAt).startOf('day'), 'day') + 1);
}

export function getCaseTotalElapsedDays(item, options = {}, now = new Date()) {
  const firstHistory = (item?.pipelineStageHistory || [])
    .map((entry) => entry.enteredAt).filter((value) => value && dayjs(value).isValid())
    .sort((a, b) => dayjs(a).valueOf() - dayjs(b).valueOf())[0];
  const startedAt = item?.createdAt || firstHistory || item?.pipelineStageUpdatedAt || item?.updatedAt;
  if (!startedAt || !dayjs(startedAt).isValid()) return null;
  const completed = getCasePipelineStageId(item, options) === 'completed';
  const endedAt = completed ? getCasePipelineUpdatedAt(item, options) : now;
  return Math.max(1, dayjs(endedAt).startOf('day').diff(dayjs(startedAt).startOf('day'), 'day') + 1);
}

/** 切換案件流程並留下每次真正進入階段的日期；自動串接可禁止倒退。 */
export function advanceCasePipeline(item = {}, stageId, enteredAt = new Date().toISOString(), { allowBackward = true } = {}) {
  const targetIndex = CASE_PIPELINE_STAGES.findIndex((stage) => stage.id === stageId);
  const currentIndex = CASE_PIPELINE_STAGES.findIndex((stage) => stage.id === item.pipelineStage);
  if (targetIndex < 0 || (!allowBackward && currentIndex > targetIndex)) return item;
  const history = Array.isArray(item.pipelineStageHistory) ? [...item.pipelineStageHistory] : [];
  const changed = currentIndex !== targetIndex || !item.pipelineStageUpdatedAt;
  if (changed && !history.some((entry) => entry.stageId === stageId && entry.enteredAt === enteredAt)) {
    history.push({ stageId, enteredAt });
  }
  return {
    ...item,
    pipelineStage: stageId,
    pipelineStageUpdatedAt: changed ? enteredAt : item.pipelineStageUpdatedAt,
    pipelineStageHistory: history,
  };
}

/**
 * 把使用者親自選擇的案件追蹤規劃換算成日期。
 * 沒選模式、日期或有效天數時回傳空字串，不替使用者偷偷帶預設值。
 */
export function resolveCaseFollowUpTarget({ mode, date, amount, unit, baseDate } = {}) {
  if (mode === 'date') {
    const value = String(date || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value).isValid() ? value : '';
  }
  if (mode === 'relative') {
    const count = Number(amount);
    if (!Number.isInteger(count) || count < 1) return '';
    const base = dayjs(baseDate || undefined);
    if (!base.isValid()) return '';
    return base.add(count, unit === 'weeks' ? 'week' : 'day').format('YYYY-MM-DD');
  }
  return '';
}

export function inferCaseType(quote) {
  return quote?.excludeVehiclePrice ? 'modification' : 'purchase';
}

export function buildLegacyCaseSeeds({ deals = [], quotes = [], clients = [], existingCases = [] } = {}) {
  const clientMap = new Map(clients.map((row) => [row.id, row]));
  const quoteMap = new Map(quotes.map((row) => [row.id, row]));
  const linkedQuoteIds = new Set(deals.map((row) => row.quoteId).filter(Boolean));
  const existingIds = new Set(existingCases.map((row) => row.id));
  const now = new Date().toISOString();
  const seeds = [];

  for (const deal of deals) {
    const id = `case:deal:${deal.id}`;
    if (deal.caseId && existingIds.has(deal.caseId)) continue;
    if (existingIds.has(id)) continue;
    const quote = quoteMap.get(deal.quoteId);
    const client = clientMap.get(deal.clientId);
    seeds.push({
      id,
      clientId: deal.clientId || quote?.clientId || null,
      clientName: deal.clientName || client?.name || quote?.customerName || '未命名客戶',
      type: inferCaseType(quote),
      title: deal.model || quote?.model || (inferCaseType(quote) === 'modification' ? '改車案件' : '購車案件'),
      status: 'active',
      dealId: deal.id,
      quoteIds: deal.quoteId ? [deal.quoteId] : [],
      source: 'legacy-deal',
      createdAt: deal.createdAt || deal.date || now,
      updatedAt: deal.updatedAt || deal.createdAt || deal.date || now,
      pipelineStageUpdatedAt: deal.updatedAt || deal.createdAt || deal.date || now,
    });
  }

  for (const quote of quotes) {
    if (quote.caseArchivedAt || quote.archivedAt) continue;
    if (quote.caseId && existingIds.has(quote.caseId)) continue;
    const id = `case:quote:${quote.id}`;
    if (linkedQuoteIds.has(quote.id) || existingIds.has(id)) continue;
    const client = clientMap.get(quote.clientId);
    seeds.push({
      id,
      clientId: quote.clientId || null,
      clientName: quote.customerName || client?.name || '未命名客戶',
      type: inferCaseType(quote),
      title: quote.model || (inferCaseType(quote) === 'modification' ? '改車報價' : '購車報價'),
      status: 'active',
      dealId: null,
      quoteIds: [quote.id],
      source: 'legacy-quote',
      createdAt: quote.createdAt || quote.date || now,
      updatedAt: quote.updatedAt || quote.createdAt || quote.date || now,
      pipelineStageUpdatedAt: quote.updatedAt || quote.createdAt || quote.date || now,
    });
  }
  return seeds;
}

function dueGroup(due, state, waitingOn, followUpReminder = false) {
  if (followUpReminder && due) {
    const value = dayjs(due).startOf('day');
    const current = dayjs().startOf('day');
    if (value.isBefore(current)) return 'overdue';
    if (value.isSame(current)) return 'today';
  }
  if (state === 'waiting' || waitingOn) return 'waiting';
  if (!due) return 'next';
  const value = dayjs(due).startOf('day');
  const current = dayjs().startOf('day');
  if (value.isBefore(current)) return 'overdue';
  if (value.isSame(current)) return 'today';
  return 'next';
}

export function buildWorkQueue({ workItems = [], tasks = [], clients = [], deals = [], cases = [] } = {}) {
  const caseMap = new Map(cases.map((row) => [row.id, row]));
  const clientMap = new Map(clients.map((row) => [row.id, row]));
  const rows = [];
  const activeCasesByClient = new Map();
  cases.filter((row) => row.clientId && row.status !== 'completed').forEach((row) => {
    const list = activeCasesByClient.get(row.clientId) || [];
    list.push(row);
    activeCasesByClient.set(row.clientId, list);
  });
  const onlyCaseForClient = (clientId) => {
    const list = activeCasesByClient.get(clientId) || [];
    return list.length === 1 ? list[0].id : null;
  };
  const caseNumbersForClient = (clientId) => (activeCasesByClient.get(clientId) || [])
    .map((row) => row.caseNumber).filter(Boolean).sort((a, b) => a - b);
  const push = (row) => rows.push({ ...row, group: dueGroup(row.due, row.state, row.waitingOn, row.followUpReminder) });

  cases.filter((row) => row.status !== 'completed' && row.nextFollowUpDate).forEach((row) => {
    push({
      id: `case-follow-up:${row.id}`, sourceType: 'case-follow-up', sourceId: row.id,
      title: '聯繫客戶', due: row.nextFollowUpDate, state: 'todo', caseId: row.id,
      clientId: row.clientId || null, clientName: row.clientName || clientMap.get(row.clientId)?.name || '',
      caseTitle: row.title || '',
    });
  });

  workItems.filter((row) => row.state !== 'done' && (!row.caseId || caseMap.has(row.caseId))).forEach((row) => {
    const linkedCase = caseMap.get(row.caseId);
    push({ ...row, sourceType: 'workItem', sourceId: row.id, clientName: row.clientName || linkedCase?.clientName || clientMap.get(row.clientId)?.name || '', caseTitle: linkedCase?.title || '', caseNumber: linkedCase?.caseNumber });
  });
  tasks.filter((row) => !row.done && (!row.caseId || caseMap.has(row.caseId))).forEach((row) => {
    const caseId = row.caseId || onlyCaseForClient(row.clientId);
    push({
      id: `task:${row.id}`, sourceType: 'task', sourceId: row.id, title: row.title || row.text || '待辦事項',
      due: row.due || row.date || '', state: 'todo', clientId: row.clientId || null,
      caseId, caseNumber: caseMap.get(caseId)?.caseNumber, clientName: clientMap.get(row.clientId)?.name || '', createdAt: row.createdAt,
    });
  });
  clients.forEach((client) => {
    const caseId = onlyCaseForClient(client.id);
    const caseNumbers = caseNumbersForClient(client.id);
    (client.todos || []).filter((row) => !row.done).forEach((row) => push({
      id: `client-todo:${client.id}:${row.id}`, sourceType: 'client-todo', sourceId: row.id,
      title: row.text || row.title || '客戶待辦', due: row.due || '', state: 'todo', caseId: row.caseId || caseId, caseNumber: caseMap.get(row.caseId || caseId)?.caseNumber, caseNumbers, clientId: client.id, clientName: client.name,
    }));
  });
  deals.filter((deal) => !deal.caseArchivedAt).forEach((deal) => {
    const linkedCase = cases.find((row) => row.id === deal.caseId || row.dealId === deal.id);
    const workflow = normalizeDeliveryWorkflow(deal);
    workflow.filter((step) => !['done', 'na'].includes(step.status)).forEach((step) => {
      const waitingOn = getWaitingOn(step, workflow);
      const timing = getStageTiming(step, workflow);
      const calculatedDue = step.activatedAt && timing.elapsedDays != null
        ? dayjs(step.activatedAt).add(timing.plannedDays - 1, 'day').format('YYYY-MM-DD')
        : '';
      const blockedFollowUpDate = step.status === 'blocked' ? step.blockedFollowUpDate || '' : '';
      push({
        id: `delivery:${deal.id}:${step.id}`, sourceType: 'delivery', sourceId: step.id, dealId: deal.id,
        title: step.label, due: blockedFollowUpDate || step.plannedDate || calculatedDue,
        state: waitingOn || step.status === 'blocked' ? 'waiting' : 'todo',
        waitingOn: waitingOn?.label || (step.status === 'blocked' ? [step.blockedReason || '階段已標記卡住', step.blockedOwner ? `等待 ${step.blockedOwner}` : ''].filter(Boolean).join('・') : ''),
        followUpReminder: Boolean(blockedFollowUpDate),
        caseId: linkedCase?.id || onlyCaseForClient(deal.clientId), clientId: deal.clientId || null, clientName: clientMap.get(deal.clientId)?.name || deal.clientName || '',
        caseTitle: deal.model || deal.note || '交車案件', caseNumber: linkedCase?.caseNumber,
      });
    });
  });
  const order = { overdue: 0, today: 1, waiting: 2, next: 3 };
  return rows.sort((a, b) => (order[a.group] - order[b.group]) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.title).localeCompare(String(b.title)));
}


import dayjs from 'dayjs';
import { getWaitingOn, normalizeDeliveryWorkflow } from './delivery.js';

export const CASE_TYPE_LABEL = { purchase: '購車', modification: '改車' };
export const CASE_STATUS_LABEL = { active: '進行中', waiting: '等待中', completed: '已完成' };

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
    if (existingIds.has(id)) continue;
    const quote = quoteMap.get(deal.quoteId);
    const client = clientMap.get(deal.clientId);
    seeds.push({
      id,
      clientId: deal.clientId || quote?.clientId || null,
      clientName: deal.clientName || client?.name || quote?.customerName || '未命名客戶',
      type: inferCaseType(quote),
      title: deal.model || quote?.model || (inferCaseType(quote) === 'modification' ? '改裝案件' : '購車案件'),
      status: 'active',
      dealId: deal.id,
      quoteIds: deal.quoteId ? [deal.quoteId] : [],
      source: 'legacy-deal',
      createdAt: deal.createdAt || deal.date || now,
      updatedAt: deal.updatedAt || deal.createdAt || deal.date || now,
    });
  }

  for (const quote of quotes) {
    const id = `case:quote:${quote.id}`;
    if (linkedQuoteIds.has(quote.id) || existingIds.has(id)) continue;
    const client = clientMap.get(quote.clientId);
    seeds.push({
      id,
      clientId: quote.clientId || null,
      clientName: quote.customerName || client?.name || '未命名客戶',
      type: inferCaseType(quote),
      title: quote.model || (inferCaseType(quote) === 'modification' ? '改裝報價' : '購車報價'),
      status: 'active',
      dealId: null,
      quoteIds: [quote.id],
      source: 'legacy-quote',
      createdAt: quote.createdAt || quote.date || now,
      updatedAt: quote.updatedAt || quote.createdAt || quote.date || now,
    });
  }
  return seeds;
}

function dueGroup(due, state, waitingOn) {
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
  const push = (row) => rows.push({ ...row, group: dueGroup(row.due, row.state, row.waitingOn) });

  workItems.filter((row) => row.state !== 'done').forEach((row) => {
    const linkedCase = caseMap.get(row.caseId);
    push({ ...row, sourceType: 'workItem', sourceId: row.id, clientName: row.clientName || linkedCase?.clientName || clientMap.get(row.clientId)?.name || '', caseTitle: linkedCase?.title || '' });
  });
  tasks.filter((row) => !row.done).forEach((row) => push({
    id: `task:${row.id}`, sourceType: 'task', sourceId: row.id, title: row.title || row.text || '待辦事項',
    due: row.due || row.date || '', state: 'todo', clientId: row.clientId || null,
    clientName: clientMap.get(row.clientId)?.name || '', createdAt: row.createdAt,
  }));
  clients.forEach((client) => {
    if (client.nextDate) push({ id: `client-next:${client.id}`, sourceType: 'client-next', sourceId: client.id, title: '聯繫客戶', due: client.nextDate, state: 'todo', clientId: client.id, clientName: client.name });
    (client.todos || []).filter((row) => !row.done).forEach((row) => push({
      id: `client-todo:${client.id}:${row.id}`, sourceType: 'client-todo', sourceId: row.id,
      title: row.text || row.title || '客戶待辦', due: row.due || '', state: 'todo', clientId: client.id, clientName: client.name,
    }));
  });
  deals.forEach((deal) => {
    const workflow = normalizeDeliveryWorkflow(deal);
    workflow.filter((step) => !['done', 'na'].includes(step.status)).forEach((step) => {
      const waitingOn = getWaitingOn(step, workflow);
      push({
        id: `delivery:${deal.id}:${step.id}`, sourceType: 'delivery', sourceId: step.id, dealId: deal.id,
        title: step.label, due: step.plannedDate || '', state: waitingOn ? 'waiting' : 'todo', waitingOn: waitingOn?.label || '',
        clientId: deal.clientId || null, clientName: clientMap.get(deal.clientId)?.name || deal.clientName || '',
        caseTitle: deal.model || deal.note || '交車案件',
      });
    });
  });
  const order = { overdue: 0, today: 1, waiting: 2, next: 3 };
  return rows.sort((a, b) => (order[a.group] - order[b.group]) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.title).localeCompare(String(b.title)));
}


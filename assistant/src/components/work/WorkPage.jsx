import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { buildWorkQueue } from '../../utils/cases';
import { addDays, today } from '../../utils/date';
import { generateId } from '../../utils/crm';
import { normalizeDeliveryWorkflow } from '../../utils/delivery';

const FILTERS = [
  ['overdue', '逾期'], ['today', '今天'], ['waiting', '等待'], ['next', '接下來'],
];

function dueText(row) {
  if (row.waitingOn) return `等待：${row.waitingOn}`;
  if (!row.due) return '尚未排日期';
  if (row.group === 'overdue') return `逾期 ${dayjs(row.due).format('MM/DD')}`;
  if (row.group === 'today') return '今天';
  return dayjs(row.due).format('MM/DD（ddd）');
}

export default function WorkPage({ onOpenClient, onOpenCase, onQuickCreate }) {
  const {
    workItems, tasks, clients, deals, cases,
    saveWorkItem, saveTask, updateClient, saveDeal, saveActivity,
  } = useApp();
  const queue = useMemo(() => buildWorkQueue({ workItems, tasks, clients, deals, cases }), [workItems, tasks, clients, deals, cases]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([key]) => [key, queue.filter((row) => row.group === key).length])), [queue]);
  const firstActive = FILTERS.find(([key]) => counts[key] > 0)?.[0] || 'today';
  const [filter, setFilter] = useState(firstActive);
  const [snoozing, setSnoozing] = useState(null);
  const visible = queue.filter((row) => row.group === filter);

  async function writeActivity(row, text) {
    if (!row.caseId && !row.clientId) return;
    await saveActivity({
      id: generateId('activity'), caseId: row.caseId || null, clientId: row.clientId || null,
      type: 'work', text, date: today(),
    });
  }

  async function complete(row) {
    if (row.sourceType === 'workItem') {
      const current = workItems.find((item) => item.id === row.sourceId);
      if (current) await saveWorkItem({ ...current, state: 'done', completedAt: new Date().toISOString() });
    } else if (row.sourceType === 'task') {
      const current = tasks.find((item) => item.id === row.sourceId);
      if (current) await saveTask({ ...current, done: true, doneAt: new Date().toISOString() });
    } else if (row.sourceType === 'client-next') {
      await updateClient(row.clientId, (client) => ({
        ...client, nextDate: '', lastContact: today(), missedCalls: 0,
        log: [...(client.log || []), { id: generateId('log'), date: today(), type: 'contact', text: '已完成聯繫' }],
      }));
    } else if (row.sourceType === 'client-todo') {
      await updateClient(row.clientId, (client) => ({
        ...client, todos: (client.todos || []).map((item) => item.id === row.sourceId ? { ...item, done: true, doneAt: new Date().toISOString() } : item),
      }));
    } else if (row.sourceType === 'delivery') {
      const deal = deals.find((item) => item.id === row.dealId);
      if (deal) await saveDeal({
        ...deal,
        deliveryWorkflow: normalizeDeliveryWorkflow(deal).map((step) => step.id === row.sourceId ? { ...step, status: 'done', updatedAt: new Date().toISOString() } : step),
      });
    }
    await writeActivity(row, `完成：${row.title}`);
  }

  async function snooze(row, days) {
    const due = addDays(today(), days);
    if (row.sourceType === 'workItem') {
      const current = workItems.find((item) => item.id === row.sourceId);
      if (current) await saveWorkItem({ ...current, due, state: 'todo' });
    }
    if (row.sourceType === 'task') {
      const current = tasks.find((item) => item.id === row.sourceId);
      if (current) await saveTask({ ...current, due });
    }
    if (row.sourceType === 'client-next') await updateClient(row.clientId, (client) => ({ ...client, nextDate: due }));
    if (row.sourceType === 'client-todo') await updateClient(row.clientId, (client) => ({ ...client, todos: (client.todos || []).map((item) => item.id === row.sourceId ? { ...item, due } : item) }));
    if (row.sourceType === 'delivery') {
      const deal = deals.find((item) => item.id === row.dealId);
      if (deal) await saveDeal({ ...deal, deliveryWorkflow: normalizeDeliveryWorkflow(deal).map((step) => step.id === row.sourceId ? { ...step, plannedDate: due, updatedAt: new Date().toISOString() } : step) });
    }
    setSnoozing(null);
  }

  function openRow(row) {
    if (row.caseId && onOpenCase) onOpenCase(row.caseId);
    else if (row.clientId) onOpenClient?.(row.clientId);
  }

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-5 py-4 md:py-6 space-y-4">
      <section className="rounded-2xl border border-copper/30 bg-gradient-to-br from-copper/15 via-s1 to-accent/8 p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] text-copper">ACTION WORKBENCH</p>
            <h1 className="text-2xl font-bold text-ink mt-1">今天先做什麼</h1>
            <p className="text-sm text-ink-2 mt-1">只顯示需要處理的下一步。</p>
          </div>
          <button type="button" onClick={onQuickCreate} className="btn-primary min-h-11 shrink-0">＋ 新增</button>
        </div>
      </section>

      <div className="grid grid-cols-4 gap-2" role="tablist" aria-label="工作篩選">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setFilter(key)}
            className={`min-h-14 rounded-xl border px-1.5 py-2 text-center transition-colors ${filter === key ? 'border-copper bg-copper/12 text-copper' : 'border-bdr bg-s1 text-ink-2'}`}>
            <strong className="block text-lg leading-none">{counts[key]}</strong>
            <span className="block text-[11px] mt-1">{label}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <section className="card px-5 py-10 text-center">
          <div className="text-4xl">✓</div>
          <h2 className="font-bold text-ink mt-3">這一區目前沒有工作</h2>
          <p className="text-sm text-ink-3 mt-1">有新進度時會自動集中到這裡。</p>
        </section>
      ) : (
        <div className="space-y-3">
          {visible.map((row) => (
            <article key={row.id} className={`card p-4 border-l-4 ${row.group === 'overdue' ? 'border-l-danger' : row.group === 'waiting' ? 'border-l-gold' : 'border-l-copper'}`}>
              <button type="button" onClick={() => openRow(row)} className="w-full text-left">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-ink leading-snug">{row.title}</p>
                    {(row.clientName || row.caseTitle) && <p className="text-xs text-ink-2 mt-1 truncate">{[row.clientName, row.caseTitle].filter(Boolean).join('・')}</p>}
                  </div>
                  <span className={`badge shrink-0 ${row.group === 'overdue' ? 'bg-danger/12 text-danger' : row.group === 'waiting' ? 'bg-gold/12 text-gold' : 'bg-accent/10 text-accent'}`}>{dueText(row)}</span>
                </div>
              </button>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => complete(row)} className="btn-primary flex-1 min-h-10">✓ 完成</button>
                <button type="button" onClick={() => setSnoozing(snoozing === row.id ? null : row.id)} className="btn-outline min-h-10">延後</button>
                <button type="button" onClick={() => openRow(row)} className="btn-ghost min-h-10 px-3">開啟</button>
              </div>
              {snoozing === row.id && (
                <div className="grid grid-cols-3 gap-2 mt-2 rounded-xl bg-s2 p-2">
                  {[1, 3, 7].map((days) => <button key={days} type="button" onClick={() => snooze(row, days)} className="btn-outline bg-s1 min-h-10">＋{days} 天</button>)}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { buildWorkQueue } from '../../utils/cases';
import { addDays, today } from '../../utils/date';
import { generateId } from '../../utils/crm';
import { normalizeDeliveryWorkflow } from '../../utils/delivery';
import CalendarPage from '../calendar/CalendarPage';

const FILTERS = [
  ['overdue', '逾期'], ['today', '今天'], ['waiting', '等待'], ['next', '接下來'],
];

function dueText(row) {
  if (row.followUpReminder && row.group === 'overdue') return `該追了・${dayjs(row.due).format('MM/DD')}`;
  if (row.followUpReminder && row.group === 'today') return '今天要追';
  if (row.waitingOn) return `等待：${row.waitingOn}`;
  if (!row.due) return '尚未排日期';
  if (row.group === 'overdue') return `逾期 ${dayjs(row.due).format('MM/DD')}`;
  if (row.group === 'today') return '今天';
  return dayjs(row.due).format('MM/DD（ddd）');
}

export default function WorkPage({ onOpenClient, onOpenCase, onOpenOperations, onQuickCreate }) {
  const {
    workItems, tasks, clients, deals, cases, events,
    saveWorkItem, saveTask, updateClient, saveActivity, saveCase, saveDeal,
  } = useApp();
  const queue = useMemo(() => buildWorkQueue({ workItems, tasks, clients, deals, cases, events }), [workItems, tasks, clients, deals, cases, events]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([key]) => [key, queue.filter((row) => row.group === key).length])), [queue]);
  // 預設把「逾期＋今天」放在同一張清單（一打開就是現在要做的事）；點上方數字可只看某一類，再點一次回到預設。
  const [picked, setPicked] = useState(null);
  const filter = picked;
  const setFilter = (key) => setPicked((current) => (current === key ? null : key));
  const [view, setView] = useState('list'); // list 清單｜calendar 月曆（同一份佇列）
  const [snoozing, setSnoozing] = useState(null);
  const [canceling, setCanceling] = useState(null);
  const [completingId, setCompletingId] = useState(null);
  const completeBusy = useRef(false);
  const visible = filter ? queue.filter((row) => row.group === filter) : queue.filter((row) => ['overdue', 'today'].includes(row.group));
  const nextAvailableFilter = FILTERS.find(([key]) => key !== filter && counts[key] > 0 && (filter || !['overdue', 'today'].includes(key)));

  async function writeActivity(row, text) {
    if (!row.caseId && !row.clientId) return;
    await saveActivity({
      id: generateId('activity'), caseId: row.caseId || null, clientId: row.clientId || null,
      type: 'work', text, date: today(),
    });
  }

  async function complete(row) {
    if (completeBusy.current) return;
    const navigates = ['stock-alert', 'delivery', 'case-follow-up', 'case-stale', 'event', 'client-delivery'].includes(row.sourceType);
    if (!navigates) { completeBusy.current = true; setCompletingId(row.id); }
    try {
      await completeInner(row);
    } catch (err) {
      console.error(err);
      window.alert(err?.message || '完成失敗，請再試一次。');
    } finally {
      completeBusy.current = false;
      setCompletingId(null);
    }
  }

  async function completeInner(row) {
    if (row.sourceType === 'stock-alert') { onOpenCase?.(row.caseId); return; }
    if (row.sourceType === 'delivery') {
      onOpenOperations?.(row.dealId, row.caseId);
      return;
    }
    if (row.sourceType === 'case-follow-up' || row.sourceType === 'case-stale') {
      onOpenCase?.(row.caseId);
      return;
    }
    if (row.sourceType === 'event') { setView('calendar'); return; }
    if (row.sourceType === 'client-delivery') { onOpenClient?.(row.clientId); return; }
    if (row.sourceType === 'client-follow') {
      await updateClient(row.clientId, (client) => ({
        ...client, lastContact: today(), missedCalls: 0, nextDate: null,
        log: [...(client.log || []), { id: generateId('log'), date: today(), text: '已聯繫', type: 'contact' }],
      }));
      return;
    }
    if (row.sourceType === 'workItem') {
      const current = workItems.find((item) => item.id === row.sourceId);
      if (current) await saveWorkItem({ ...current, state: 'done', completedAt: new Date().toISOString() });
    } else if (row.sourceType === 'task') {
      const current = tasks.find((item) => item.id === row.sourceId);
      if (current) await saveTask({ ...current, done: true, doneAt: new Date().toISOString() });
    } else if (row.sourceType === 'client-todo') {
      await updateClient(row.clientId, (client) => ({
        ...client, todos: (client.todos || []).map((item) => item.id === row.sourceId ? { ...item, done: true, doneAt: new Date().toISOString() } : item),
      }));
    }
    await writeActivity(row, `完成：${row.title}`);
  }

  async function snooze(row, days) {
    if (row.sourceType === 'stock-alert') { onOpenCase?.(row.caseId); return; }
    if (row.sourceType === 'delivery') {
      onOpenOperations?.(row.dealId, row.caseId);
      setSnoozing(null);
      return;
    }
    const due = addDays(today(), days);
    if (row.sourceType === 'event' || row.sourceType === 'client-delivery') { setSnoozing(null); return; }
    if (row.sourceType === 'client-follow') {
      await updateClient(row.clientId, (client) => ({ ...client, nextDate: due }));
      setSnoozing(null);
      return;
    }
    if (row.sourceType === 'case-follow-up' || row.sourceType === 'case-stale') {
      const current = cases.find((item) => item.id === row.caseId);
      if (current) await saveCase({ ...current, nextFollowUpDate: due, updatedAt: new Date().toISOString() });
      setSnoozing(null);
      return;
    }
    if (row.sourceType === 'workItem') {
      const current = workItems.find((item) => item.id === row.sourceId);
      if (current) await saveWorkItem({ ...current, due, state: 'todo' });
    }
    if (row.sourceType === 'task') {
      const current = tasks.find((item) => item.id === row.sourceId);
      if (current) await saveTask({ ...current, due });
    }
    if (row.sourceType === 'client-todo') await updateClient(row.clientId, (client) => ({ ...client, todos: (client.todos || []).map((item) => item.id === row.sourceId ? { ...item, due } : item) }));
    setSnoozing(null);
  }

  async function cancel(row) {
    if (row.sourceType === 'stock-alert' || row.sourceType === 'event' || row.sourceType === 'client-delivery' || row.sourceType === 'case-stale') { if (row.caseId) onOpenCase?.(row.caseId); setCanceling(null); return; }
    const canceledAt = new Date().toISOString();
    if (row.sourceType === 'client-follow') {
      await updateClient(row.clientId, (client) => ({ ...client, nextDate: null }));
    } else if (row.sourceType === 'case-follow-up') {
      const current = cases.find((item) => item.id === row.caseId);
      if (current) await saveCase({ ...current, nextFollowUpDate: '', updatedAt: canceledAt });
    } else if (row.sourceType === 'delivery') {
      const deal = deals.find((item) => item.id === row.dealId);
      if (deal) {
        const deliveryWorkflow = normalizeDeliveryWorkflow(deal).map((step) => step.id === row.sourceId
          ? { ...step, status: 'na', completedAt: canceledAt, statusChangedAt: canceledAt }
          : step);
        await saveDeal({ ...deal, deliveryWorkflow });
      }
    } else if (row.sourceType === 'workItem') {
      const current = workItems.find((item) => item.id === row.sourceId);
      if (current) await saveWorkItem({ ...current, state: 'cancelled', canceledAt });
    } else if (row.sourceType === 'task') {
      const current = tasks.find((item) => item.id === row.sourceId);
      if (current) await saveTask({ ...current, done: true, canceled: true, doneAt: canceledAt, canceledAt });
    } else if (row.sourceType === 'client-todo') {
      await updateClient(row.clientId, (client) => ({
        ...client,
        todos: (client.todos || []).map((item) => item.id === row.sourceId ? { ...item, done: true, canceled: true, doneAt: canceledAt, canceledAt } : item),
      }));
    }
    await writeActivity(row, `取消：${row.title}`);
    setCanceling(null);
  }

  function openRow(row) {
    if (row.sourceType === 'delivery') onOpenOperations?.(row.dealId, row.caseId);
    else if (row.caseId && onOpenCase) onOpenCase(row.caseId);
    else if (row.clientId) onOpenClient?.(row.clientId);
  }

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-5 py-3 md:py-6 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-ink leading-tight">今天</h1>
          <p className="text-xs text-ink-3">{dayjs().format('M月D日 dddd')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-bdr bg-s1 p-0.5" role="tablist" aria-label="檢視方式">
            {[['list', '清單'], ['calendar', '月曆']].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
                className={`min-h-10 px-3 rounded-lg text-sm font-semibold ${view === key ? 'bg-copper/15 text-copper' : 'text-ink-2'}`}>{label}</button>
            ))}
          </div>
          <button type="button" onClick={onQuickCreate} className="btn-primary min-h-10 shrink-0">＋ 新增</button>
        </div>
      </div>

      {view === 'calendar' ? <CalendarPage embedded onOpenClient={onOpenClient} onOpenCase={onOpenCase} /> : <>
      <div className="grid grid-cols-4 gap-2" role="tablist" aria-label="工作篩選">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setFilter(key)}
            className={`min-h-12 rounded-xl border px-1.5 py-1.5 text-center transition-colors ${filter === key ? 'border-copper bg-copper/12 text-copper' : !filter && ['overdue', 'today'].includes(key) ? 'border-copper/40 bg-s1 text-ink' : 'border-bdr bg-s1 text-ink-2'}`}>
            <strong className="block text-lg leading-none">{counts[key]}</strong>
            <span className="block text-[11px] mt-1">{label}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <section className="card px-5 py-10 text-center">
          <div className="text-4xl">✓</div>
          <h2 className="font-bold text-ink mt-3">這一區目前沒有工作</h2>
          <p className="text-sm text-ink-3 mt-1">{nextAvailableFilter ? `還有 ${counts[nextAvailableFilter[0]]} 件「${nextAvailableFilter[1]}」工作。` : '目前所有工作都已處理完畢。'}</p>
          {nextAvailableFilter && <button type="button" onClick={() => setFilter(nextAvailableFilter[0])} className="btn-primary mt-4 min-h-11 px-5">前往{nextAvailableFilter[1]}工作</button>}
        </section>
      ) : (
        <div className="space-y-2">
          {visible.map((row) => (
            <article key={row.id} className={`card p-3 border-l-4 ${row.group === 'overdue' ? 'border-l-danger' : row.group === 'waiting' ? 'border-l-gold' : 'border-l-copper'}`}>
              <button type="button" onClick={() => openRow(row)} className="w-full text-left">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-ink leading-snug">{row.title}</p>
                    {row.urgent && <p className="mt-1 text-xs font-bold text-danger">🔴 急件</p>}
                    {(row.clientName || row.caseTitle) && <p className="text-xs text-ink-2 mt-1 truncate">{[row.clientName, row.caseTitle].filter(Boolean).join('・')}</p>}
                    {row.followUpReminder && row.waitingOn && <p className="mt-1 text-xs font-semibold text-danger">{row.waitingOn}</p>}
                  </div>
                  <span className={`badge shrink-0 ${row.group === 'overdue' ? 'bg-danger/12 text-danger' : row.group === 'waiting' ? 'bg-gold/12 text-gold' : 'bg-accent/10 text-accent'}`}>{dueText(row)}</span>
                </div>
              </button>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={completingId != null} onClick={() => complete(row)} className="btn-primary flex-1 min-h-10 disabled:opacity-50">{row.sourceType === 'stock-alert' ? '核對配件' : row.sourceType === 'delivery' ? '處理進度' : ['case-follow-up', 'case-stale'].includes(row.sourceType) ? '記錄聯繫' : row.sourceType === 'event' ? '看月曆' : row.sourceType === 'client-delivery' ? '開客戶' : row.sourceType === 'client-follow' ? '已聯繫' : '✓ 完成'}</button>
                {!['stock-alert', 'event', 'client-delivery'].includes(row.sourceType) && <button type="button" onClick={() => row.sourceType === 'delivery' ? (row.caseId ? onOpenCase?.(row.caseId) : onOpenOperations?.(row.dealId, row.caseId)) : setSnoozing(snoozing === row.id ? null : row.id)} className="btn-outline min-h-10">{row.sourceType === 'delivery' ? '看案件' : '延後'}</button>}
                {row.sourceType !== 'delivery' && <button type="button" onClick={() => openRow(row)} className="btn-ghost min-h-10 px-3">開啟</button>}
                {row.sourceType !== 'stock-alert' && <button type="button" onClick={() => setCanceling(canceling === row.id ? null : row.id)} className="btn-ghost min-h-10 px-3 text-danger">取消</button>}
              </div>
              {canceling === row.id && (
                <div role="alert" className="mt-2 rounded-xl border border-danger/35 bg-danger/5 p-3">
                  <p className="text-sm font-bold text-danger">確定取消「{row.title}」？</p>
                  <p className="mt-1 text-xs text-ink-3">取消後會從工作台隱藏，但案件紀錄仍會保留。</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setCanceling(null)} className="btn-outline min-h-10">先不要</button>
                    <button type="button" onClick={() => cancel(row)} className="btn-danger min-h-10">確認取消</button>
                  </div>
                </div>
              )}
              {snoozing === row.id && (
                <div className="grid grid-cols-3 gap-2 mt-2 rounded-xl bg-s2 p-2">
                  {[1, 3, 7].map((days) => <button key={days} type="button" onClick={() => snooze(row, days)} className="btn-outline bg-s1 min-h-10">＋{days} 天</button>)}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      </>}
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { applyCaseContact, buildWorkQueue, CASE_CLOSE_REASONS, CONTACT_PRESETS, getCasePipelineStageId } from '../../utils/cases';
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
    workItems, tasks, clients, deals, cases, events, quoteDrafts = [],
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
  const [closing, setClosing] = useState(null);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkIds, setBulkIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const staleRows = useMemo(() => queue.filter((row) => row.sourceType === 'case-stale'), [queue]);
  const [completingId, setCompletingId] = useState(null);
  // 直接在今天頁記錄聯繫（不用跳進案件）：contact＝正在記錄的那一列
  const [contact, setContact] = useState(null);
  const [contactText, setContactText] = useState('');
  const [contactDate, setContactDate] = useState('');
  const [contactError, setContactError] = useState('');
  const [contactSaving, setContactSaving] = useState(false);
  const phoneByClient = useMemo(() => new Map(clients.map((row) => [row.id, String(row.phone || '').trim()])), [clients]);

  function startContact(row) {
    setContact(row); setContactText(''); setContactError('');
    setContactDate(addDays(today(), 3));
    setSnoozing(null); setClosing(null); setCanceling(null);
  }

  async function recordContact(event, preset = null) {
    event?.preventDefault?.();
    if (contactSaving || !contact) return;
    const current = cases.find((item) => item.id === contact.caseId);
    if (!current) { setContactError('找不到這筆案件，請重新整理後再試。'); return; }
    const resultText = (preset?.result ?? contactText).trim();
    const nextDate = preset ? addDays(today(), preset.days) : contactDate;
    if (!resultText) { setContactError('請填寫這次聯繫結果，或直接按上面的一鍵記錄。'); return; }
    if (!nextDate) { setContactError('請設定下次追蹤日。'); return; }
    setContactSaving(true);
    setContactError('');
    const timestamp = new Date().toISOString();
    try {
      const stageId = getCasePipelineStageId(current, { deals, quotes: quoteDrafts });
      await saveCase(applyCaseContact(current, stageId, { nextDate, timestamp }));
      await saveActivity({ id: generateId('activity'), caseId: current.id, clientId: current.clientId, clientName: current.clientName, type: 'contact', text: `聯繫：${resultText}`, date: timestamp });
      setContact(null);
    } catch (cause) {
      setContactError(cause?.message || '聯繫紀錄儲存失敗，請再試一次。');
    } finally {
      setContactSaving(false);
    }
  }
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
      startContact(row);
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

  // 不追了：案件改成「結案（不追蹤）」，之後不再出現在今天；客戶層追蹤日則直接清掉。隨時可在案件頁「不追蹤」重新追蹤。
  async function closeRow(row, reason) {
    if (completeBusy.current) return;
    completeBusy.current = true;
    try {
      const stamp = new Date().toISOString();
      if (row.caseId) {
        const current = cases.find((item) => item.id === row.caseId);
        if (current) await saveCase({ ...current, status: 'closed', closedReason: reason, closedAt: stamp, nextFollowUpDate: '', updatedAt: stamp });
      }
      if (row.sourceType === 'client-follow') {
        await updateClient(row.clientId, (client) => ({
          ...client, nextDate: null,
          log: [...(client.log || []), { id: generateId('log'), date: today(), text: `不再追蹤：${reason}`, type: 'contact' }],
        }));
      }
      await writeActivity(row, `結案不追蹤：${reason}`);
      setClosing(null);
    } catch (err) {
      console.error(err);
      window.alert(err?.message || '儲存失敗，請再試一次。');
    } finally {
      completeBusy.current = false;
    }
  }

  async function bulkClose(reason) {
    if (bulkBusy || bulkIds.length === 0) return;
    setBulkBusy(true);
    const stamp = new Date().toISOString();
    try {
      for (const caseId of bulkIds) {
        const current = cases.find((item) => item.id === caseId);
        if (!current) continue;
        await saveCase({ ...current, status: 'closed', closedReason: reason, closedAt: stamp, nextFollowUpDate: '', updatedAt: stamp });
        await saveActivity({ id: generateId('activity'), caseId, clientId: current.clientId || null, type: 'work', text: `結案不追蹤：${reason}`, date: today() });
      }
      setBulkIds([]);
      setShowBulk(false);
    } catch (err) {
      console.error(err);
      window.alert(err?.message || '批次結案失敗，請再試一次。');
    } finally {
      setBulkBusy(false);
    }
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

      {staleRows.length >= 2 && view !== 'calendar' && <button type="button" onClick={() => { setShowBulk(true); setBulkIds([]); }} className="w-full min-h-11 rounded-xl border border-gold/40 bg-gold/10 px-4 text-left text-sm font-bold text-gold">🧹 {staleRows.length} 筆太久沒追・一次整理</button>}
      {showBulk && <div className="fixed inset-0 z-50 bg-bg safe-panel overflow-y-auto anim-slide-up"><div className="max-w-xl mx-auto min-h-full bg-s1 md:my-8 md:min-h-0 md:rounded-2xl md:border md:border-bdr">
        <header className="sticky top-0 z-10 bg-s1/95 backdrop-blur border-b border-bdr px-4 py-3 flex items-center gap-3"><button type="button" onClick={() => setShowBulk(false)} className="btn-ghost min-h-11 px-3">←</button><h2 className="font-bold text-lg text-ink flex-1">整理太久沒追的案件</h2><button type="button" onClick={() => setBulkIds(bulkIds.length === staleRows.length ? [] : staleRows.map((row) => row.caseId))} className="btn-outline min-h-10 text-xs">{bulkIds.length === staleRows.length ? '取消全選' : '全選'}</button></header>
        <div className="p-4 space-y-2 pb-44">
          <p className="text-sm text-ink-2">勾選「已經沒興趣」的，下面選原因，一次結案。結案的不會再出現在今天，可到「案件 → 不追蹤」隨時重新追蹤。沒勾的維持原樣。</p>
          {staleRows.map((row) => <label key={row.id} className="card flex items-center gap-3 p-3"><input type="checkbox" checked={bulkIds.includes(row.caseId)} onChange={(event) => setBulkIds((ids) => event.target.checked ? [...ids, row.caseId] : ids.filter((id) => id !== row.caseId))} className="h-6 w-6 shrink-0" /><span className="min-w-0 flex-1"><strong className="block truncate text-ink">{row.clientName || '未命名客戶'}</strong><span className="block truncate text-xs text-ink-3">{row.caseTitle}・{row.title}</span></span></label>)}
        </div>
        <div className="fixed bottom-0 left-0 right-0 bg-s1/95 backdrop-blur border-t border-bdr p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"><div className="max-w-xl mx-auto"><p className="mb-2 text-xs font-bold text-ink-2">已勾 {bulkIds.length} 筆・選原因結案</p><div className="grid grid-cols-4 gap-2">{CASE_CLOSE_REASONS.map((reason) => <button key={reason} type="button" disabled={bulkBusy || bulkIds.length === 0} onClick={() => bulkClose(reason)} className="btn-primary min-h-11 px-1 text-[11px] font-bold disabled:opacity-40">{reason}</button>)}</div></div></div>
      </div></div>}
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
            <article key={row.id} className={`card px-3 py-2.5 border-l-4 ${row.group === 'overdue' ? 'border-l-danger' : row.group === 'waiting' ? 'border-l-gold' : 'border-l-copper'}`}>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => openRow(row)} className="min-w-0 flex-1 text-left">
                  <p className="font-bold text-ink leading-snug truncate">{row.urgent && <span className="text-danger">🔴 </span>}{row.clientName || row.title}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-2"><span className={`font-semibold ${row.group === 'overdue' ? 'text-danger' : row.group === 'waiting' ? 'text-gold' : 'text-accent'}`}>{dueText(row)}</span>{[row.clientName ? row.title : '', row.caseTitle].filter(Boolean).map((text) => `・${text}`).join('')}</p>
                  {row.followUpReminder && row.waitingOn && <p className="mt-0.5 truncate text-xs font-semibold text-danger">{row.waitingOn}</p>}
                </button>
                {phoneByClient.get(row.clientId) && <a href={`tel:${phoneByClient.get(row.clientId)}`} onClick={() => { if (['case-follow-up', 'case-stale'].includes(row.sourceType)) startContact(row); }} aria-label={`撥打給${row.clientName || '客戶'}`} className="btn-primary flex h-11 w-11 shrink-0 items-center justify-center p-0 text-lg">📞</a>}
                <button type="button" disabled={completingId != null} onClick={() => complete(row)} className={`${phoneByClient.get(row.clientId) ? 'btn-outline' : 'btn-primary'} h-11 shrink-0 px-2.5 text-sm font-bold disabled:opacity-50`}>{row.sourceType === 'stock-alert' ? '核對' : row.sourceType === 'delivery' ? '處理' : ['case-follow-up', 'case-stale'].includes(row.sourceType) ? '記錄' : row.sourceType === 'event' ? '月曆' : row.sourceType === 'client-delivery' ? '開啟' : row.sourceType === 'client-follow' ? '已聯繫' : '✓ 完成'}</button>
                {!['stock-alert', 'event', 'client-delivery'].includes(row.sourceType) && <button type="button" onClick={() => { if (row.sourceType === 'delivery') { row.caseId ? onOpenCase?.(row.caseId) : onOpenOperations?.(row.dealId, row.caseId); return; } setClosing(null); setCanceling(null); setSnoozing(snoozing === row.id ? null : row.id); }} className="h-11 shrink-0 rounded-xl px-2 text-sm font-semibold text-ink-3">{row.sourceType === 'delivery' ? '案件' : '延後'}</button>}
              </div>
              {closing === row.id && <div className="mt-2 rounded-xl bg-s2 p-2"><p className="px-1 text-xs font-bold text-ink-2">為什麼不追了？（選一個就結案，之後不會再出現）</p><div className="mt-2 grid grid-cols-2 gap-2">{CASE_CLOSE_REASONS.map((reason) => <button key={reason} type="button" onClick={() => closeRow(row, reason)} className="btn-outline bg-s1 min-h-10 text-xs font-bold">{reason}</button>)}</div><button type="button" onClick={() => setClosing(null)} className="mt-2 w-full min-h-9 text-xs text-ink-3">先不要</button></div>}
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
                  {['case-stale', 'case-follow-up', 'client-follow'].includes(row.sourceType)
                    ? <button type="button" onClick={() => { setSnoozing(null); setClosing(row.id); }} className="col-span-3 min-h-10 rounded-lg text-sm font-semibold text-ink-2">⏹ 不追了（沒興趣／買別家／聯絡不上…）</button>
                    : !['stock-alert', 'event', 'client-delivery', 'delivery'].includes(row.sourceType) && <button type="button" onClick={() => { setSnoozing(null); setCanceling(row.id); }} className="col-span-3 min-h-10 rounded-lg text-sm font-semibold text-danger">不用做了（取消這件）</button>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      </>}
      {contact && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 md:items-center md:p-4"><form onSubmit={recordContact} className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-bdr bg-s1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-panel md:rounded-2xl">
        <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold text-teal">記錄聯繫</p><h2 className="truncate text-lg font-bold text-ink">{contact.clientName || '未命名客戶'}</h2><p className="truncate text-xs text-ink-3">{contact.caseTitle}</p></div><button type="button" onClick={() => setContact(null)} className="h-11 w-11 shrink-0 rounded-xl border border-bdr" aria-label="關閉">×</button></div>
        <p className="mt-4 text-xs font-bold text-ink-2">結果是？按一下就記好</p>
        <div className="mt-2 grid grid-cols-2 gap-2">{CONTACT_PRESETS.map((preset) => <button key={preset.label} type="button" disabled={contactSaving} onClick={() => recordContact(null, preset)} className="btn-primary min-h-16 px-2 text-sm font-bold disabled:opacity-50">{preset.label}</button>)}</div>
        <details className="mt-4 rounded-xl border border-bdr"><summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-ink-2">自己寫結果／指定日期</summary><div className="border-t border-bdr p-3">
          <label className="block text-xs font-bold text-ink-2">聯繫結果<textarea value={contactText} onChange={(event) => setContactText(event.target.value)} rows={2} placeholder="例：客戶確認要雙廂自排，等待貸款資料" className="mt-2 w-full resize-none" /></label>
          <label className="mt-3 block text-xs font-bold text-ink-2">下次追蹤日<input type="date" value={contactDate} onChange={(event) => setContactDate(event.target.value)} className="mt-2 min-h-12 w-full" /></label>
          <button type="submit" disabled={contactSaving} className="btn-primary mt-3 min-h-12 w-full">{contactSaving ? '儲存中…' : '儲存聯繫紀錄'}</button>
        </div></details>
        {contactError && <p role="alert" className="mt-3 rounded-xl bg-danger/10 p-3 text-sm text-danger">{contactError}</p>}
        <button type="button" onClick={() => { const id = contact.caseId; setContact(null); onOpenCase?.(id); }} className="mt-3 w-full min-h-10 text-xs font-semibold text-ink-3">打開這筆案件 ›</button>
      </form></div>}
    </div>
  );
}

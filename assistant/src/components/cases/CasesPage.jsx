import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { buildWorkQueue, CASE_STATUS_LABEL, CASE_TYPE_LABEL } from '../../utils/cases';
import { addDays, today } from '../../utils/date';
import { formatMoney, generateId } from '../../utils/crm';
import { buildDeliverySchedule, getStageTiming, getWaitingOn, normalizeDeliveryWorkflow, updateWorkflowStepStatus } from '../../utils/delivery';

const STATUS_FILTERS = [['active', '進行中'], ['waiting', '等待中'], ['completed', '已完成'], ['all', '全部']];

export default function CasesPage({ focusId, startNewToken, initialClientId, onFocusConsumed, onStartConsumed, onNewClosed, onOpenClient, onOpenQuote, onOpenOperations }) {
  const { cases, workItems, activities, tasks, clients, deals, quoteDrafts, cats, stages, saveCase, saveWorkItem, saveActivity, saveClient, saveTask, updateClient, saveDeal } = useApp();
  const [filter, setFilter] = useState('active');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (focusId) { setSelectedId(focusId); onFocusConsumed?.(); }
  }, [focusId, onFocusConsumed]);
  useEffect(() => {
    if (startNewToken) { setShowNew(true); onStartConsumed?.(); }
  }, [startNewToken, onStartConsumed]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...cases]
      .filter((row) => filter === 'all' || row.status === filter)
      .filter((row) => !needle || [row.clientName, row.title, CASE_TYPE_LABEL[row.type]].some((value) => String(value || '').toLowerCase().includes(needle)))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }, [cases, filter, query]);
  const workQueue = useMemo(() => buildWorkQueue({ workItems, tasks, clients, deals, cases }), [workItems, tasks, clients, deals, cases]);
  const selected = cases.find((row) => row.id === selectedId);

  return (
    <div className="max-w-4xl mx-auto px-3 md:px-5 py-4 md:py-6 space-y-4">
      <section className="rounded-2xl border border-teal/30 bg-gradient-to-br from-teal/14 via-s1 to-sage/8 p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] text-teal">CUSTOMER CASES</p>
            <h1 className="text-2xl font-bold text-ink mt-1">客戶案件</h1>
            <p className="text-sm text-ink-2 mt-1">同一位客戶可有多筆購車或改車案件。</p>
          </div>
          <button type="button" onClick={() => setShowNew(true)} className="btn-primary min-h-11 shrink-0">＋ 新案件</button>
        </div>
      </section>

      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋客戶或案件…" className="w-full min-h-11" />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTERS.map(([key, label]) => {
          const count = key === 'all' ? cases.length : cases.filter((row) => row.status === key).length;
          return <button key={key} type="button" onClick={() => setFilter(key)} className={`shrink-0 min-h-10 rounded-full border px-3 text-sm ${filter === key ? 'border-teal bg-teal/12 text-teal' : 'border-bdr bg-s1 text-ink-2'}`}>{label} {count}</button>;
        })}
      </div>

      {rows.length === 0 ? (
        <section className="card p-9 text-center">
          <div className="text-4xl">📁</div>
          <h2 className="font-bold text-ink mt-3">這裡還沒有案件</h2>
          <p className="text-sm text-ink-3 mt-1">新增後，只要從案件處理下一步即可。</p>
          <button type="button" onClick={() => setShowNew(true)} className="btn-primary mt-4">＋ 建立第一筆案件</button>
        </section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((item) => {
            const caseActions = workQueue.filter((row) => row.caseId === item.id);
            const action = caseActions.find((row) => row.state !== 'waiting') || caseActions[0];
            return (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className="card p-4 text-left hover:border-teal/50 active:scale-[0.99] transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className={`badge ${item.type === 'modification' ? 'bg-violet/12 text-violet' : 'bg-teal/12 text-teal'}`}>{CASE_TYPE_LABEL[item.type] || '案件'}</span>
                      <span className="badge bg-s2 text-ink-2">{CASE_STATUS_LABEL[item.status] || '進行中'}</span>
                    </div>
                    <h2 className="font-bold text-ink mt-2 truncate">{item.clientName || '未命名客戶'}</h2>
                    <p className="text-sm text-ink-2 truncate">{item.title || '未命名案件'}</p>
                  </div>
                  <span className="text-ink-3">›</span>
                </div>
                <div className="mt-3 rounded-lg bg-s2 px-3 py-2">
                  <p className="text-[10px] text-ink-3">下一步</p>
                  <p className={`text-sm mt-0.5 ${action ? 'text-ink font-medium' : 'text-ink-3'}`}>{action?.title || '尚未安排工作'}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showNew && <NewCaseModal clients={clients} cats={cats} stages={stages} initialClientId={initialClientId} onClose={() => { setShowNew(false); onNewClosed?.(); }} onSaveCase={saveCase} onSaveClient={saveClient} onSaveWorkItem={saveWorkItem} onSaveActivity={saveActivity} onCreated={(id) => { setShowNew(false); onNewClosed?.(); setSelectedId(id); }} />}
      {selected && <CaseDetail item={selected} workItems={workItems} tasks={tasks} caseQueue={workQueue.filter((row) => row.caseId === selected.id)} activities={activities} deals={deals} quotes={quoteDrafts} onClose={() => setSelectedId(null)} onSaveCase={saveCase} onSaveWorkItem={saveWorkItem} onSaveActivity={saveActivity} onSaveTask={saveTask} onUpdateClient={updateClient} onSaveDeal={saveDeal} onOpenClient={onOpenClient} onOpenQuote={onOpenQuote} onOpenOperations={onOpenOperations} />}
    </div>
  );
}

function NewCaseModal({ clients, cats, stages, initialClientId, onClose, onSaveCase, onSaveClient, onSaveWorkItem, onSaveActivity, onCreated }) {
  const [clientMode, setClientMode] = useState(clients.length ? 'existing' : 'new');
  const [clientId, setClientId] = useState(initialClientId || clients[0]?.id || '');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState('purchase');
  const [title, setTitle] = useState('');
  const [nextTitle, setNextTitle] = useState('確認客戶需求');
  const [due, setDue] = useState(addDays(today(), 1));
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    let client = clients.find((row) => row.id === clientId);
    if (clientMode === 'new') {
      if (!name.trim()) { setSaving(false); return; }
      client = await onSaveClient({
        id: generateId('client'), name: name.trim(), phone: phone.trim(), source: '案件建立',
        catId: cats[0]?.id || '', stageId: stages[0]?.id || '', clientType: 'personal',
        intentLevel: 0, nextDate: '', notes: '', log: [], missedCalls: 0,
      });
    }
    if (!client) { setSaving(false); return; }
    const id = generateId('case');
    const item = await onSaveCase({
      id, clientId: client.id, clientName: client.name, type, status: 'active',
      title: title.trim() || (type === 'purchase' ? '購車案件' : '改裝案件'), source: 'manual', quoteIds: [], dealId: null,
    });
    if (nextTitle.trim()) await onSaveWorkItem({ id: generateId('work'), caseId: id, clientId: client.id, clientName: client.name, title: nextTitle.trim(), due, state: 'todo' });
    await onSaveActivity({ id: generateId('activity'), caseId: id, clientId: client.id, type: 'created', text: `建立${CASE_TYPE_LABEL[type]}案件`, date: today() });
    onCreated(item.id);
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg safe-panel overflow-y-auto anim-slide-up">
      <form onSubmit={submit} className="max-w-xl mx-auto min-h-full bg-s1 md:my-8 md:min-h-0 md:rounded-2xl md:border md:border-bdr">
        <header className="sticky top-0 z-10 bg-s1/95 backdrop-blur border-b border-bdr px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={onClose} className="btn-ghost min-h-11 px-3">←</button>
          <h2 className="font-bold text-lg text-ink flex-1">建立客戶案件</h2>
          <button type="submit" disabled={saving} className="btn-primary min-h-11">{saving ? '儲存中…' : '建立'}</button>
        </header>
        <div className="p-4 space-y-5 pb-28">
          <section>
            <label className="section-title block px-0">1. 客戶</label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button type="button" onClick={() => setClientMode('existing')} className={`min-h-12 rounded-xl border ${clientMode === 'existing' ? 'border-teal bg-teal/12 text-teal' : 'border-bdr'}`}>選既有客戶</button>
              <button type="button" onClick={() => setClientMode('new')} className={`min-h-12 rounded-xl border ${clientMode === 'new' ? 'border-teal bg-teal/12 text-teal' : 'border-bdr'}`}>建立新客戶</button>
            </div>
            {clientMode === 'existing' ? <select value={clientId} onChange={(event) => setClientId(event.target.value)} className="w-full min-h-12 mt-3">{clients.map((row) => <option key={row.id} value={row.id}>{row.name}{row.phone ? `・${row.phone}` : ''}</option>)}</select>
              : <div className="grid grid-cols-1 gap-2 mt-3"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="客戶姓名或公司名稱（必填）" className="min-h-12" /><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="電話（選填）" className="min-h-12" /></div>}
          </section>
          <section>
            <label className="section-title block px-0">2. 案件種類</label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[['purchase', '🚛 購車'], ['modification', '🛠️ 改車']].map(([key, label]) => <button key={key} type="button" onClick={() => setType(key)} className={`min-h-16 rounded-xl border text-base font-bold ${type === key ? 'border-teal bg-teal/12 text-teal' : 'border-bdr'}`}>{label}</button>)}
            </div>
          </section>
          <section className="space-y-2">
            <label className="section-title block px-0">3. 案件與下一步</label>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={type === 'purchase' ? '例：K2500 雙廂購車' : '例：尾門＋帆布改裝'} className="w-full min-h-12" />
            <input value={nextTitle} onChange={(event) => setNextTitle(event.target.value)} placeholder="下一步要做什麼" className="w-full min-h-12" />
            <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className="w-full min-h-12" />
          </section>
        </div>
      </form>
    </div>
  );
}

function CaseDetail({ item, workItems, tasks, caseQueue, activities, deals, quotes, onClose, onSaveCase, onSaveWorkItem, onSaveActivity, onSaveTask, onUpdateClient, onSaveDeal, onOpenClient, onOpenQuote, onOpenOperations }) {
  const [newTitle, setNewTitle] = useState('');
  const [due, setDue] = useState(addDays(today(), 1));
  const [section, setSection] = useState('overview');
  const linkedDeal = deals.find((row) => row.id === item.dealId || row.caseId === item.id);
  const linkedQuotes = quotes.filter((row) => (item.quoteIds || []).includes(row.id));
  const caseWork = workItems.filter((row) => row.caseId === item.id);
  const pending = caseQueue;
  const actionablePending = pending.filter((row) => row.state !== 'waiting');
  const waitingPending = pending.filter((row) => row.state === 'waiting');
  const completed = caseWork.filter((row) => row.state === 'done');
  const timeline = activities.filter((row) => row.caseId === item.id).sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  const workflow = normalizeDeliveryWorkflow(linkedDeal);
  const schedule = buildDeliverySchedule(workflow);
  const completedStages = workflow.filter((step) => ['done', 'na'].includes(step.status)).length;
  const currentStage = workflow.find((step) => !['done', 'na'].includes(step.status) && !getWaitingOn(step, workflow))
    || workflow.find((step) => !['done', 'na'].includes(step.status)) || null;
  const currentTiming = currentStage ? getStageTiming(currentStage, workflow) : null;
  const workflowPercent = workflow.length ? Math.round(completedStages / workflow.length * 100) : 0;
  const workflowStart = linkedDeal?.deliveryWorkflowStartDate || linkedDeal?.date || '';
  const targetDate = workflowStart && schedule.totalDays ? dayjs(workflowStart).add(schedule.totalDays - 1, 'day').format('YYYY/MM/DD') : '';

  async function addWork(event) {
    event.preventDefault();
    if (!newTitle.trim()) return;
    await onSaveWorkItem({ id: generateId('work'), caseId: item.id, clientId: item.clientId, clientName: item.clientName, title: newTitle.trim(), due, state: 'todo' });
    await onSaveActivity({ id: generateId('activity'), caseId: item.id, clientId: item.clientId, type: 'work', text: `新增工作：${newTitle.trim()}`, date: today() });
    setNewTitle('');
  }

  async function finishWork(row) {
    if (row.sourceType === 'workItem') {
      const source = workItems.find((work) => work.id === row.sourceId);
      if (source) await onSaveWorkItem({ ...source, state: 'done', completedAt: new Date().toISOString() });
    } else if (row.sourceType === 'task') {
      const source = tasks.find((task) => task.id === row.sourceId);
      if (source) await onSaveTask({ ...source, done: true, doneAt: new Date().toISOString() });
    } else if (row.sourceType === 'client-next') {
      await onUpdateClient(row.clientId, (client) => ({ ...client, nextDate: '', lastContact: today(), missedCalls: 0 }));
    } else if (row.sourceType === 'client-todo') {
      await onUpdateClient(row.clientId, (client) => ({ ...client, todos: (client.todos || []).map((todo) => todo.id === row.sourceId ? { ...todo, done: true, doneAt: new Date().toISOString() } : todo) }));
    } else if (row.sourceType === 'delivery') {
      const deal = deals.find((dealRow) => dealRow.id === row.dealId);
      if (deal) await onSaveDeal({ ...deal, deliveryWorkflow: updateWorkflowStepStatus(normalizeDeliveryWorkflow(deal), row.sourceId, 'done') });
    }
    await onSaveActivity({ id: generateId('activity'), caseId: item.id, clientId: item.clientId, type: 'work', text: `完成：${row.title}`, date: today() });
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg safe-panel overflow-y-auto anim-slide-right">
      <div className="max-w-3xl mx-auto min-h-full bg-bg">
        <header className="sticky top-0 z-20 bg-s1/95 backdrop-blur border-b border-bdr px-3 py-2.5 flex items-center gap-2">
          <button type="button" onClick={onClose} className="btn-ghost min-h-11 px-3">←</button>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink truncate">{item.clientName || '未命名客戶'}</p>
            <p className="text-xs text-ink-3 truncate">{CASE_TYPE_LABEL[item.type]}・{item.title}</p>
          </div>
          <select value={item.status} onChange={(event) => onSaveCase({ ...item, status: event.target.value })} className="min-h-10 text-xs w-24">
            <option value="active">進行中</option><option value="waiting">等待中</option><option value="completed">已完成</option>
          </select>
        </header>

        <div className="p-3 md:p-5 space-y-4 pb-28">
          <section className="grid grid-cols-3 gap-2">
            <button type="button" disabled={!item.clientId} onClick={() => item.clientId && onOpenClient?.(item.clientId)} className="card min-h-16 px-2 py-3 text-xs font-bold text-accent disabled:opacity-40">👤 客戶資料</button>
            <button type="button" onClick={() => onOpenQuote?.(item, linkedQuotes[0]?.id || null)} className="card min-h-16 px-2 py-3 text-xs font-bold text-gold">🧾 {linkedQuotes.length ? `報價 ${linkedQuotes.length}` : '建立報價'}</button>
            <button type="button" disabled={!linkedDeal} onClick={() => linkedDeal && onOpenOperations?.(linkedDeal.id)} className="card min-h-16 px-2 py-3 text-xs font-bold text-copper disabled:opacity-40">🚚 {linkedDeal ? '施工進度' : '尚未成交'}</button>
          </section>

          <nav className="grid grid-cols-4 gap-1 rounded-xl border border-bdr bg-s1 p-1 sticky top-[3.9rem] z-10">
            {[['overview', '總覽'], ['work', '工作'], ['quotes', '報價'], ['history', '紀錄']].map(([key, label]) => <button key={key} type="button" onClick={() => setSection(key)} className={`min-h-10 rounded-lg text-xs font-bold ${section === key ? 'bg-teal text-on-accent' : 'text-ink-2'}`}>{label}</button>)}
          </nav>

          {(section === 'overview' || section === 'work') && <section className="card p-4">
            <h2 className="font-bold text-ink">下一步</h2>
            {pending.length === 0 ? <p className="text-sm text-ink-3 mt-3">尚未安排工作。</p> : <div className="space-y-2 mt-3">{actionablePending.map((row) => <div key={row.id} className="rounded-xl border border-bdr bg-s2 p-3 flex items-center gap-3"><button type="button" onClick={() => finishWork(row)} className="w-10 h-10 rounded-full border-2 border-ok text-ok font-bold shrink-0" aria-label={`完成 ${row.title}`}>✓</button><div className="min-w-0 flex-1"><p className="font-medium text-ink">{row.title}</p><p className="text-xs text-ink-3 mt-0.5">{row.due ? dayjs(row.due).format('YYYY/MM/DD') : '未排日期'}</p></div></div>)}{actionablePending.length === 0 && <p className="rounded-xl bg-s2 p-3 text-sm text-ink-3">目前工作都在等待前置階段。</p>}{waitingPending.length > 0 && <details className="rounded-xl border border-bdr bg-s2/50"><summary className="cursor-pointer px-3 py-3 text-xs font-bold text-ink-2">等待中的後續 {waitingPending.length} 項</summary><div className="space-y-2 border-t border-bdr px-3 py-3">{waitingPending.map((row) => <div key={row.id}><p className="text-sm text-ink">{row.title}</p><p className="text-[11px] text-ink-3">{row.waitingOn || '等待前置工作'}</p></div>)}</div></details>}</div>}
            <form onSubmit={addWork} className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="新增下一步…" className="min-h-11" />
              <button className="btn-primary min-h-11">加入</button>
              <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className="min-h-11 col-span-2" />
            </form>
          </section>}

          {section === 'overview' && workflow.length > 0 && <section className="card overflow-hidden"><div className="p-4"><div className="flex items-center justify-between gap-2"><div><h2 className="font-bold text-ink">施工控制塔</h2><p className="mt-0.5 text-[11px] text-ink-3">這筆案件的成交後進度</p></div><button type="button" onClick={() => onOpenOperations?.(linkedDeal.id)} className="btn-outline min-h-10 text-xs">管理／設定</button></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-s3"><div className="h-full rounded-full bg-ok" style={{ width: `${workflowPercent}%` }} /></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-s2 p-2"><p className="text-[10px] text-ink-3">進度</p><p className="font-bold text-ok">{workflowPercent}%</p></div><div className="rounded-lg bg-s2 p-2"><p className="text-[10px] text-ink-3">總工期</p><p className="font-bold text-accent">{schedule.totalDays} 天</p></div><div className="rounded-lg bg-s2 p-2"><p className="text-[10px] text-ink-3">預計完成</p><p className="text-xs font-bold text-ink">{targetDate || '未設定'}</p></div></div>{currentStage && <div className={`mt-3 rounded-xl border p-3 ${currentTiming?.urgency === 'overdue' ? 'border-danger/40 bg-danger/5' : 'border-accent/35 bg-accent/5'}`}><p className="text-[10px] font-bold text-accent">目前階段</p><p className="mt-0.5 font-bold text-ink">{currentStage.label}</p><p className={`mt-1 text-xs ${currentTiming?.urgency === 'overdue' ? 'font-bold text-danger' : 'text-ink-3'}`}>{currentTiming?.elapsedDays ? `已停留 ${currentTiming.elapsedDays} 天／分配 ${currentTiming.plannedDays} 天${currentTiming.overDays ? `・超過 ${currentTiming.overDays} 天` : ''}` : '尚未開始計時'}</p><button type="button" onClick={async () => onSaveDeal({ ...linkedDeal, deliveryWorkflow: updateWorkflowStepStatus(workflow, currentStage.id, 'done') })} className="btn-primary mt-3 min-h-11 w-full text-sm">✓ 完成目前階段</button></div>}</div><details className="border-t border-bdr"><summary className="cursor-pointer px-4 py-3 text-xs font-bold text-ink-2">查看全部 {workflow.length} 個階段</summary><div className="space-y-2 px-4 pb-4">{workflow.map((step, index) => { const waiting = getWaitingOn(step, workflow); return <div key={step.id} className="flex gap-3"><div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${['done', 'na'].includes(step.status) ? 'bg-ok text-on-accent' : waiting ? 'bg-gold/15 text-gold' : 'bg-accent/12 text-accent'}`}>{['done', 'na'].includes(step.status) ? '✓' : index + 1}</div><div className="min-w-0 pb-2"><p className="text-sm font-medium text-ink">{step.label}</p><p className="text-[11px] text-ink-3">{waiting ? `等待：${waiting.label}` : `${getStageTiming(step, workflow).plannedDays} 天`}</p></div></div>; })}</div></details></section>}

          {(section === 'overview' || section === 'quotes') && <section className="card p-4"><div className="flex items-center justify-between"><h2 className="font-bold text-ink">案件報價與成交</h2><button type="button" onClick={() => onOpenQuote?.(item, null)} className="text-xs text-gold">＋ 新報價</button></div>{linkedQuotes.length === 0 && !linkedDeal && <p className="text-sm text-ink-3 mt-3">尚未建立報價或成交資料。</p>}{linkedQuotes.map((quote) => <button type="button" onClick={() => onOpenQuote?.(item, quote.id)} key={quote.id} className="mt-3 w-full flex items-center justify-between gap-3 text-left"><div><p className="text-sm text-ink">報價・{quote.model || '未填車型'}</p><p className="text-xs text-ink-3">{quote.date}</p></div><strong className="text-gold">NT$ {formatMoney(quote.total)} ›</strong></button>)}{linkedDeal && <button type="button" onClick={() => onOpenOperations?.(linkedDeal.id)} className="mt-3 w-full flex items-center justify-between gap-3 text-left"><div><p className="text-sm text-ink">成交・{linkedDeal.model || linkedDeal.note || '車輛'}</p><p className="text-xs text-ink-3">{linkedDeal.date}</p></div><strong className="text-copper">NT$ {formatMoney(linkedDeal.amount)} ›</strong></button>}</section>}

          {section === 'history' && <section className="card p-4"><h2 className="font-bold text-ink">案件紀錄</h2>{timeline.length === 0 ? <p className="text-sm text-ink-3 mt-3">目前沒有紀錄。</p> : <div className="mt-3 space-y-3">{timeline.map((row) => <div key={row.id} className="border-l-2 border-bdr pl-3"><p className="text-sm text-ink">{row.text}</p><p className="text-[11px] text-ink-3 mt-0.5">{dayjs(row.date || row.createdAt).format('YYYY/MM/DD HH:mm')}</p></div>)}</div>}</section>}
          {section === 'work' && completed.length > 0 && <details className="card p-4"><summary className="font-bold text-ink cursor-pointer">已完成工作 {completed.length} 項</summary><div className="mt-3 space-y-2">{completed.map((row) => <p key={row.id} className="text-sm text-ink-3 line-through">✓ {row.title}</p>)}</div></details>}
        </div>
      </div>
    </div>
  );
}

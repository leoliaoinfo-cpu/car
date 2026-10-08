import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import {
  buildWorkQueue, CASE_STATUS_LABEL, CASE_TYPE_LABEL, getCaseStatusLabel, resolveCaseDeliveryTarget,
} from '../../utils/cases';
import { today } from '../../utils/date';
import { formatMoney, generateId } from '../../utils/crm';
import { buildDeliverySchedule, getStageTiming, getWaitingOn, normalizeDeliveryWorkflow } from '../../utils/delivery';
import { ClientPicker } from '../ui';

const STATUS_FILTERS = [['active', '進行中'], ['waiting', '等待中'], ['completed', '已完成'], ['all', '全部']];

export default function CasesPage({ focusId, startNewToken, initialClientId, onFocusConsumed, onStartConsumed, onNewClosed, onOpenClient, onOpenQuote, onOpenOperations }) {
  const { cases, workItems, activities, tasks, clients, deals, quoteDrafts, cats, stages, saveCase, saveWorkItem, saveActivity, saveClient, saveTask, updateClient } = useApp();
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
      .filter((row) => !needle || [row.clientName, row.title, CASE_TYPE_LABEL[row.type], getCaseStatusLabel(row), row.expectedDeliveryDate]
        .some((value) => String(value || '').toLowerCase().includes(needle)))
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
                      <span className="badge bg-s2 text-ink-2">{getCaseStatusLabel(item)}</span>
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
                <p className={`mt-2 text-xs ${item.expectedDeliveryDate ? 'text-copper' : 'font-semibold text-gold'}`}>
                  {item.expectedDeliveryDate ? `預計交車 ${dayjs(item.expectedDeliveryDate).format('YYYY/MM/DD')}` : '尚未設定預計交車日期'}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {showNew && <NewCaseModal clients={clients} cats={cats} stages={stages} initialClientId={initialClientId} onClose={() => { setShowNew(false); onNewClosed?.(); }} onSaveCase={saveCase} onSaveClient={saveClient} onSaveWorkItem={saveWorkItem} onSaveActivity={saveActivity} onCreated={(id) => { setShowNew(false); onNewClosed?.(); setSelectedId(id); }} />}
      {selected && <CaseDetail item={selected} workItems={workItems} tasks={tasks} caseQueue={workQueue.filter((row) => row.caseId === selected.id)} activities={activities} deals={deals} quotes={quoteDrafts} onClose={() => setSelectedId(null)} onSaveCase={saveCase} onSaveWorkItem={saveWorkItem} onSaveActivity={saveActivity} onSaveTask={saveTask} onUpdateClient={updateClient} onOpenClient={onOpenClient} onOpenQuote={onOpenQuote} onOpenOperations={onOpenOperations} />}
    </div>
  );
}

function NewCaseModal({ clients, cats, stages, initialClientId, onClose, onSaveCase, onSaveClient, onSaveWorkItem, onSaveActivity, onCreated }) {
  const [clientMode, setClientMode] = useState(clients.length ? 'existing' : 'new');
  const [clientId, setClientId] = useState(initialClientId || '');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState('purchase');
  const [title, setTitle] = useState('');
  const [nextTitle, setNextTitle] = useState('確認客戶需求');
  const [due, setDue] = useState('');
  const [deliveryMode, setDeliveryMode] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliveryAmount, setDeliveryAmount] = useState('');
  const [deliveryUnit, setDeliveryUnit] = useState('days');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const expectedDeliveryDate = resolveCaseDeliveryTarget({
    mode: deliveryMode, date: deliveryDate, amount: deliveryAmount, unit: deliveryUnit, baseDate: today(),
  });

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (!expectedDeliveryDate) {
      setError('請先選擇「指定交車日期」或「幾天／幾週後」。系統不會替你預設。');
      return;
    }
    setSaving(true);
    let client = clients.find((row) => row.id === clientId);
    if (clientMode === 'new') {
      if (!name.trim()) { setError('請輸入客戶姓名或公司名稱。'); setSaving(false); return; }
      client = await onSaveClient({
        id: generateId('client'), name: name.trim(), phone: phone.trim(), source: '案件建立',
        catId: cats[0]?.id || '', stageId: stages[0]?.id || '', clientType: 'personal',
        intentLevel: 0, nextDate: '', notes: '', log: [], missedCalls: 0,
      });
    }
    if (!client) { setError('請先搜尋並選擇一位既有客戶。'); setSaving(false); return; }
    const id = generateId('case');
    const item = await onSaveCase({
      id, clientId: client.id, clientName: client.name, type, status: 'active',
      title: title.trim() || (type === 'purchase' ? '購車案件' : '改車案件'), source: 'manual', quoteIds: [], dealId: null,
      expectedDeliveryDate, deliveryPlanMode: deliveryMode,
      deliveryPlanBaseDate: deliveryMode === 'relative' ? today() : null,
      deliveryPlanAmount: deliveryMode === 'relative' ? Number(deliveryAmount) : null,
      deliveryPlanUnit: deliveryMode === 'relative' ? deliveryUnit : null,
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
            {clientMode === 'existing' ? <div className="mt-3"><ClientPicker clients={clients} value={clientId} onChange={setClientId} placeholder="輸入姓名或電話搜尋客戶…" /></div>
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
            <label className="block text-[11px] font-medium text-ink-3">下一步處理日期（選填）<input type="date" value={due} onChange={(event) => setDue(event.target.value)} className="mt-1 w-full min-h-12" /></label>
          </section>
          <section>
            <label className="section-title block px-0">4. 預計交車時間 <span className="text-danger">＊必選</span></label>
            <p className="mt-1 text-xs text-ink-3">由你決定日期或工期，系統不會自動套預設值。</p>
            <DeliveryTargetChooser mode={deliveryMode} onModeChange={setDeliveryMode} date={deliveryDate} onDateChange={setDeliveryDate} amount={deliveryAmount} onAmountChange={setDeliveryAmount} unit={deliveryUnit} onUnitChange={setDeliveryUnit} targetDate={expectedDeliveryDate} />
          </section>
          {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</p>}
        </div>
      </form>
    </div>
  );
}

function DeliveryTargetChooser({ mode, onModeChange, date, onDateChange, amount, onAmountChange, unit, onUnitChange, targetDate }) {
  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onModeChange('date')} className={`min-h-14 rounded-xl border px-3 text-sm font-bold ${mode === 'date' ? 'border-copper bg-copper/12 text-copper' : 'border-bdr bg-s2 text-ink-2'}`}>📅 指定日期</button>
        <button type="button" onClick={() => onModeChange('relative')} className={`min-h-14 rounded-xl border px-3 text-sm font-bold ${mode === 'relative' ? 'border-copper bg-copper/12 text-copper' : 'border-bdr bg-s2 text-ink-2'}`}>⏳ 幾天／幾週後</button>
      </div>
      {mode === 'date' && (
        <label className="block text-[11px] font-medium text-ink-3">預計交車日期<input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} className="mt-1 min-h-12 w-full" /></label>
      )}
      {mode === 'relative' && (
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <label className="block text-[11px] font-medium text-ink-3">數量<input inputMode="numeric" value={amount} onChange={(event) => onAmountChange(event.target.value.replace(/[^0-9]/g, ''))} placeholder="例如 14" className="mt-1 min-h-12 w-full" /></label>
          <label className="block text-[11px] font-medium text-ink-3">單位<select value={unit} onChange={(event) => onUnitChange(event.target.value)} className="mt-1 min-h-12 w-full"><option value="days">天後</option><option value="weeks">週後</option></select></label>
        </div>
      )}
      {targetDate && <div className="rounded-xl border border-ok/35 bg-ok/10 px-3 py-2 text-sm font-bold text-ok">預計交車：{dayjs(targetDate).format('YYYY/MM/DD')}</div>}
    </div>
  );
}

function CaseEditSheet({ item, onClose, onSaveCase, onSaveActivity }) {
  const [title, setTitle] = useState(item.title || '');
  const [type, setType] = useState(item.type || 'purchase');
  const [status, setStatus] = useState(item.status || 'active');
  const [stageLabel, setStageLabel] = useState(item.stageLabel || '');
  const [deliveryMode, setDeliveryMode] = useState(item.deliveryPlanMode || (item.expectedDeliveryDate ? 'date' : ''));
  const [deliveryDate, setDeliveryDate] = useState(item.expectedDeliveryDate || '');
  const [deliveryAmount, setDeliveryAmount] = useState(item.deliveryPlanAmount ? String(item.deliveryPlanAmount) : '');
  const [deliveryUnit, setDeliveryUnit] = useState(item.deliveryPlanUnit || 'days');
  const [deliveryBaseDate, setDeliveryBaseDate] = useState(item.deliveryPlanBaseDate || today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const expectedDeliveryDate = resolveCaseDeliveryTarget({
    mode: deliveryMode, date: deliveryDate, amount: deliveryAmount, unit: deliveryUnit, baseDate: deliveryBaseDate,
  });

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    if (!title.trim()) { setError('請輸入案件名稱。'); return; }
    if (!expectedDeliveryDate) { setError('請選擇指定交車日期，或填寫幾天／幾週後。'); return; }
    setSaving(true);
    setError('');
    await onSaveCase({
      ...item, title: title.trim(), type, status, stageLabel: stageLabel.trim(), expectedDeliveryDate,
      deliveryPlanMode: deliveryMode,
      deliveryPlanBaseDate: deliveryMode === 'relative' ? deliveryBaseDate : null,
      deliveryPlanAmount: deliveryMode === 'relative' ? Number(deliveryAmount) : null,
      deliveryPlanUnit: deliveryMode === 'relative' ? deliveryUnit : null,
    });
    await onSaveActivity({
      id: generateId('activity'), caseId: item.id, clientId: item.clientId, clientName: item.clientName,
      type: 'case', text: `更新案件：${title.trim()}・${stageLabel.trim() || CASE_STATUS_LABEL[status]}`, date: today(),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 backdrop-blur-sm md:items-center md:p-4" role="dialog" aria-modal="true" aria-labelledby="case-edit-title">
      <form onSubmit={save} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-bdr bg-s1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-panel md:rounded-2xl">
        <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-bdr md:hidden" />
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1"><p className="text-xs font-bold text-copper">案件設定</p><h2 id="case-edit-title" className="text-xl font-bold text-ink">修改案件</h2></div>
          <button type="button" onClick={onClose} className="h-11 w-11 rounded-xl border border-bdr text-xl text-ink-3" aria-label="關閉案件編輯">×</button>
        </div>
        <div className="mt-5 space-y-5">
          <label className="block text-xs font-bold text-ink-2">案件名稱<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：尾門＋帆布改裝" className="mt-2 min-h-12 w-full" /></label>
          <section><p className="text-xs font-bold text-ink-2">案件種類</p><div className="mt-2 grid grid-cols-2 gap-2">{[['purchase', '🚛 購車案件'], ['modification', '🛠️ 改車案件']].map(([key, label]) => <button key={key} type="button" onClick={() => setType(key)} className={`min-h-12 rounded-xl border font-bold ${type === key ? 'border-teal bg-teal/12 text-teal' : 'border-bdr text-ink-2'}`}>{label}</button>)}</div></section>
          <section><p className="text-xs font-bold text-ink-2">案件狀態</p><div className="mt-2 grid grid-cols-3 gap-2">{Object.entries(CASE_STATUS_LABEL).map(([key, label]) => <button key={key} type="button" onClick={() => setStatus(key)} className={`min-h-11 rounded-xl border text-xs font-bold ${status === key ? 'border-accent bg-accent/12 text-accent' : 'border-bdr text-ink-2'}`}>{label}</button>)}</div><label className="mt-3 block text-[11px] font-medium text-ink-3">自訂階段名稱（選填）<input value={stageLabel} onChange={(event) => setStageLabel(event.target.value)} placeholder="例如：等待料件、待客戶確認" className="mt-1 min-h-12 w-full" /></label></section>
          <section><p className="text-xs font-bold text-ink-2">預計交車時間</p><p className="mt-1 text-xs text-ink-3">可以改成指定日期，或從今天重新計算幾天／幾週後。</p><DeliveryTargetChooser mode={deliveryMode} onModeChange={(nextMode) => { if (nextMode === 'relative' && deliveryMode !== 'relative') setDeliveryBaseDate(today()); setDeliveryMode(nextMode); }} date={deliveryDate} onDateChange={setDeliveryDate} amount={deliveryAmount} onAmountChange={setDeliveryAmount} unit={deliveryUnit} onUnitChange={setDeliveryUnit} targetDate={expectedDeliveryDate} /></section>
          {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</p>}
          <div className="grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="btn-outline min-h-12">取消</button><button type="submit" disabled={saving} className="btn-primary min-h-12">{saving ? '儲存中…' : '確認儲存案件'}</button></div>
        </div>
      </form>
    </div>
  );
}

function CaseDetail({ item, workItems, tasks, caseQueue, activities, deals, quotes, onClose, onSaveCase, onSaveWorkItem, onSaveActivity, onSaveTask, onUpdateClient, onOpenClient, onOpenQuote, onOpenOperations }) {
  const [newTitle, setNewTitle] = useState('');
  const [due, setDue] = useState('');
  const [section, setSection] = useState('overview');
  const [showEdit, setShowEdit] = useState(false);
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
  const caseDeliveryTiming = item.expectedDeliveryDate
    ? dayjs(item.expectedDeliveryDate).startOf('day').diff(dayjs().startOf('day'), 'day')
    : null;

  async function addWork(event) {
    event.preventDefault();
    if (!newTitle.trim()) return;
    await onSaveWorkItem({ id: generateId('work'), caseId: item.id, clientId: item.clientId, clientName: item.clientName, title: newTitle.trim(), due, state: 'todo' });
    await onSaveActivity({ id: generateId('activity'), caseId: item.id, clientId: item.clientId, type: 'work', text: `新增工作：${newTitle.trim()}`, date: today() });
    setNewTitle('');
  }

  async function finishWork(row) {
    if (row.sourceType === 'delivery') {
      onOpenOperations?.(row.dealId);
      return;
    }
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
            <p className="text-xs text-ink-3 truncate">{CASE_TYPE_LABEL[item.type]}・{item.title}・{getCaseStatusLabel(item)}</p>
          </div>
          <button type="button" onClick={() => setShowEdit(true)} className="min-h-11 shrink-0 rounded-xl border border-copper/45 bg-copper/10 px-3 text-xs font-bold text-copper">✎ 編輯案件</button>
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

          {section === 'overview' && (
            <section className={`card p-4 ${item.expectedDeliveryDate ? 'border-copper/35' : 'border-gold/55 bg-gold/5'}`}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-[11px] font-bold text-copper">預計交車</p><p className="mt-1 text-lg font-bold text-ink">{item.expectedDeliveryDate ? dayjs(item.expectedDeliveryDate).format('YYYY/MM/DD') : '尚未設定'}</p>{item.expectedDeliveryDate && <p className={`mt-1 text-xs ${caseDeliveryTiming < 0 ? 'font-bold text-danger' : 'text-ink-3'}`}>{caseDeliveryTiming < 0 ? `已逾期 ${Math.abs(caseDeliveryTiming)} 天` : caseDeliveryTiming === 0 ? '今天預計交車' : `剩餘 ${caseDeliveryTiming} 天`}</p>}</div>
                <button type="button" onClick={() => setShowEdit(true)} className="btn-outline min-h-11 shrink-0 text-xs">{item.expectedDeliveryDate ? '修改時間' : '立即設定'}</button>
              </div>
            </section>
          )}

          {(section === 'overview' || section === 'work') && <section className="card p-4">
            <h2 className="font-bold text-ink">下一步</h2>
            {pending.length === 0 ? <p className="text-sm text-ink-3 mt-3">尚未安排工作。</p> : <div className="space-y-2 mt-3">{actionablePending.map((row) => <div key={row.id} className="rounded-xl border border-bdr bg-s2 p-3 flex items-center gap-3"><button type="button" onClick={() => finishWork(row)} className={`w-11 h-11 rounded-full border-2 font-bold shrink-0 ${row.sourceType === 'delivery' ? 'border-copper text-copper' : 'border-ok text-ok'}`} aria-label={row.sourceType === 'delivery' ? `前往施工進度處理 ${row.title}` : `完成 ${row.title}`}>{row.sourceType === 'delivery' ? '→' : '✓'}</button><div className="min-w-0 flex-1"><p className="font-medium text-ink">{row.title}</p><p className="text-xs text-ink-3 mt-0.5">{row.sourceType === 'delivery' ? '前往施工進度確認後再變更狀態' : (row.due ? dayjs(row.due).format('YYYY/MM/DD') : '未排日期')}</p></div></div>)}{actionablePending.length === 0 && <p className="rounded-xl bg-s2 p-3 text-sm text-ink-3">目前工作都在等待前置階段。</p>}{waitingPending.length > 0 && <details className="rounded-xl border border-bdr bg-s2/50"><summary className="cursor-pointer px-3 py-3 text-xs font-bold text-ink-2">等待中的後續 {waitingPending.length} 項</summary><div className="space-y-2 border-t border-bdr px-3 py-3">{waitingPending.map((row) => <div key={row.id}><p className="text-sm text-ink">{row.title}</p><p className="text-[11px] text-ink-3">{row.waitingOn || '等待前置工作'}</p></div>)}</div></details>}</div>}
            <form onSubmit={addWork} className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="新增下一步…" className="min-h-11" />
              <button className="btn-primary min-h-11">加入</button>
              <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className="min-h-11 col-span-2" />
            </form>
          </section>}

          {section === 'overview' && workflow.length > 0 && <section className="card overflow-hidden"><div className="p-4"><div className="flex items-center justify-between gap-2"><div><h2 className="font-bold text-ink">施工控制塔</h2><p className="mt-0.5 text-[11px] text-ink-3">這筆案件的成交後進度</p></div><button type="button" onClick={() => onOpenOperations?.(linkedDeal.id)} className="btn-outline min-h-10 text-xs">管理／設定</button></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-s3"><div className="h-full rounded-full bg-ok" style={{ width: `${workflowPercent}%` }} /></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-s2 p-2"><p className="text-[10px] text-ink-3">進度</p><p className="font-bold text-ok">{workflowPercent}%</p></div><div className="rounded-lg bg-s2 p-2"><p className="text-[10px] text-ink-3">總工期</p><p className="font-bold text-accent">{schedule.totalDays} 天</p></div><div className="rounded-lg bg-s2 p-2"><p className="text-[10px] text-ink-3">預計完成</p><p className="text-xs font-bold text-ink">{targetDate || '未設定'}</p></div></div>{currentStage && <div className={`mt-3 rounded-xl border p-3 ${currentTiming?.urgency === 'overdue' ? 'border-danger/40 bg-danger/5' : 'border-accent/35 bg-accent/5'}`}><p className="text-[10px] font-bold text-accent">目前階段</p><p className="mt-0.5 font-bold text-ink">{currentStage.label}</p><p className={`mt-1 text-xs ${currentTiming?.urgency === 'overdue' ? 'font-bold text-danger' : 'text-ink-3'}`}>{currentTiming?.elapsedDays ? `已停留 ${currentTiming.elapsedDays} 天／分配 ${currentTiming.plannedDays} 天${currentTiming.overDays ? `・超過 ${currentTiming.overDays} 天` : ''}` : '尚未開始計時'}</p><button type="button" onClick={() => onOpenOperations?.(linkedDeal.id)} className="btn-primary mt-3 min-h-11 w-full text-sm">前往施工進度處理</button></div>}</div><details className="border-t border-bdr"><summary className="cursor-pointer px-4 py-3 text-xs font-bold text-ink-2">查看全部 {workflow.length} 個階段</summary><div className="space-y-2 px-4 pb-4">{workflow.map((step, index) => { const waiting = getWaitingOn(step, workflow); return <div key={step.id} className="flex gap-3"><div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${['done', 'na'].includes(step.status) ? 'bg-ok text-on-accent' : waiting ? 'bg-gold/15 text-gold' : 'bg-accent/12 text-accent'}`}>{['done', 'na'].includes(step.status) ? '✓' : index + 1}</div><div className="min-w-0 pb-2"><p className="text-sm font-medium text-ink">{step.label}</p><p className="text-[11px] text-ink-3">{waiting ? `等待：${waiting.label}` : `${getStageTiming(step, workflow).plannedDays} 天`}</p></div></div>; })}</div></details></section>}

          {(section === 'overview' || section === 'quotes') && <section className="card p-4"><div className="flex items-center justify-between"><h2 className="font-bold text-ink">案件報價與成交</h2><button type="button" onClick={() => onOpenQuote?.(item, null)} className="text-xs text-gold">＋ 新報價</button></div>{linkedQuotes.length === 0 && !linkedDeal && <p className="text-sm text-ink-3 mt-3">尚未建立報價或成交資料。</p>}{linkedQuotes.map((quote) => <button type="button" onClick={() => onOpenQuote?.(item, quote.id)} key={quote.id} className="mt-3 w-full flex items-center justify-between gap-3 text-left"><div><p className="text-sm text-ink">報價・{quote.model || '未填車型'}</p><p className="text-xs text-ink-3">{quote.date}</p></div><strong className="text-gold">NT$ {formatMoney(quote.total)} ›</strong></button>)}{linkedDeal && <button type="button" onClick={() => onOpenOperations?.(linkedDeal.id)} className="mt-3 w-full flex items-center justify-between gap-3 text-left"><div><p className="text-sm text-ink">成交・{linkedDeal.model || linkedDeal.note || '車輛'}</p><p className="text-xs text-ink-3">{linkedDeal.date}</p></div><strong className="text-copper">NT$ {formatMoney(linkedDeal.amount)} ›</strong></button>}</section>}

          {section === 'history' && <section className="card p-4"><h2 className="font-bold text-ink">案件紀錄</h2>{timeline.length === 0 ? <p className="text-sm text-ink-3 mt-3">目前沒有紀錄。</p> : <div className="mt-3 space-y-3">{timeline.map((row) => <div key={row.id} className="border-l-2 border-bdr pl-3"><p className="text-sm text-ink">{row.text}</p><p className="text-[11px] text-ink-3 mt-0.5">{dayjs(row.date || row.createdAt).format('YYYY/MM/DD HH:mm')}</p></div>)}</div>}</section>}
          {section === 'work' && completed.length > 0 && <details className="card p-4"><summary className="font-bold text-ink cursor-pointer">已完成工作 {completed.length} 項</summary><div className="mt-3 space-y-2">{completed.map((row) => <p key={row.id} className="text-sm text-ink-3 line-through">✓ {row.title}</p>)}</div></details>}
        </div>
        {showEdit && <CaseEditSheet item={item} onClose={() => setShowEdit(false)} onSaveCase={onSaveCase} onSaveActivity={onSaveActivity} />}
      </div>
    </div>
  );
}

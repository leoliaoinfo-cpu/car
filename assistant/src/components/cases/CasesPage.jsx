import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import {
  buildWorkQueue, CASE_PIPELINE_STAGES, CASE_TYPE_LABEL, getCasePipelineStage, getCasePipelineStageId, getCaseStatusLabel, resolveCaseFollowUpTarget,
} from '../../utils/cases';
import { today } from '../../utils/date';
import { formatMoney, generateId } from '../../utils/crm';
import { buildDeliverySchedule, getCurrentWorkflowStep, getStageTiming, getWaitingOn, normalizeDeliveryWorkflow } from '../../utils/delivery';
import { ClientPicker } from '../ui';

const STATUS_FILTERS = [['active', '進行中'], ['waiting', '等待中'], ['completed', '已完成'], ['all', '全部'], ['deleted', '已刪除']];

export default function CasesPage({ focusId, startNewToken, initialClientId, onFocusConsumed, onStartConsumed, onNewClosed, onOpenClient, onOpenQuote, onOpenOperations }) {
  const { cases, deletedCases = [], workItems, activities, tasks, clients, deals, quoteDrafts, cats, stages, saveCase, deleteCase, restoreCase, saveWorkItem, saveActivity, saveClient, saveTask, updateClient } = useApp();
  const [filter, setFilter] = useState('active');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [restoringId, setRestoringId] = useState(null);
  const [restoreError, setRestoreError] = useState('');

  useEffect(() => {
    if (focusId) { setSelectedId(focusId); onFocusConsumed?.(); }
  }, [focusId, onFocusConsumed]);
  useEffect(() => {
    if (startNewToken) { setShowNew(true); onStartConsumed?.(); }
  }, [startNewToken, onStartConsumed]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = filter === 'deleted' ? deletedCases : cases;
    return [...source]
      .filter((row) => filter === 'all' || filter === 'deleted' || row.status === filter)
      .filter((row) => {
        if (!needle) return true;
        const client = clients.find((item) => item.id === row.clientId);
        const linkedDeal = deals.find((item) => item.id === row.dealId || item.caseId === row.id);
        const linkedQuotes = quoteDrafts.filter((item) => (row.quoteIds || []).includes(item.id) || item.caseId === row.id);
        return [row.clientName, row.title, CASE_TYPE_LABEL[row.type], getCaseStatusLabel(row), row.nextFollowUpDate,
          getCasePipelineStage(row, { deals, quotes: quoteDrafts }), client?.phone, client?.lineId, client?.company, client?.plate, client?.licensePlate,
          linkedDeal?.model, ...linkedQuotes.map((item) => item.model)]
          .some((value) => String(value || '').toLowerCase().includes(needle));
      })
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }, [cases, deletedCases, clients, deals, filter, query, quoteDrafts]);
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

      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋姓名、電話、車牌、車型或案件名稱…" className="w-full min-h-11" />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTERS.map(([key, label]) => {
          const count = key === 'all' ? cases.length : key === 'deleted' ? deletedCases.length : cases.filter((row) => row.status === key).length;
          return <button key={key} type="button" onClick={() => setFilter(key)} className={`shrink-0 min-h-10 rounded-full border px-3 text-sm ${filter === key ? 'border-teal bg-teal/12 text-teal' : 'border-bdr bg-s1 text-ink-2'}`}>{label} {count}</button>;
        })}
      </div>

      {restoreError && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">{restoreError}</p>}

      {rows.length === 0 ? (
        <section className="card p-9 text-center">
          <div className="text-4xl">📁</div>
          <h2 className="font-bold text-ink mt-3">{filter === 'deleted' ? '回收筒目前是空的' : '這裡還沒有案件'}</h2>
          <p className="text-sm text-ink-3 mt-1">{filter === 'deleted' ? '刪除的廢棄案件會保留在這裡，避免誤刪。' : '新增後，只要從案件處理下一步即可。'}</p>
          {filter !== 'deleted' && <button type="button" onClick={() => setShowNew(true)} className="btn-primary mt-4">＋ 建立第一筆案件</button>}
        </section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((item) => {
            if (filter === 'deleted') return (
              <article key={item.id} className="card border-danger/25 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5"><span className="badge bg-danger/10 text-danger">已刪除</span><span className={`badge ${item.type === 'modification' ? 'bg-violet/12 text-violet' : 'bg-teal/12 text-teal'}`}>{CASE_TYPE_LABEL[item.type] || '案件'}</span></div>
                    <h2 className="mt-2 truncate font-bold text-ink">{item.clientName || '未命名客戶'}</h2>
                    <p className="truncate text-sm text-ink-2">{item.title || '未命名案件'}</p>
                    <p className="mt-1 text-[11px] text-ink-3">刪除於 {dayjs(item.deletedAt).format('YYYY/MM/DD HH:mm')}</p>
                  </div>
                  <button type="button" disabled={restoringId === item.id} onClick={async () => { setRestoringId(item.id); setRestoreError(''); try { await restoreCase(item.id); } catch (cause) { setRestoreError(cause?.message || '案件恢復失敗。'); } finally { setRestoringId(null); } }} className="btn-outline min-h-11 shrink-0 text-xs">{restoringId === item.id ? '恢復中…' : '↶ 恢復'}</button>
                </div>
              </article>
            );
            const caseActions = workQueue.filter((row) => row.caseId === item.id);
            const action = caseActions.find((row) => row.state !== 'waiting') || caseActions[0];
            const pipelineStage = getCasePipelineStage(item, { deals, quotes: quoteDrafts });
            return (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className="card p-4 text-left hover:border-teal/50 active:scale-[0.99] transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className={`badge ${item.type === 'modification' ? 'bg-violet/12 text-violet' : 'bg-teal/12 text-teal'}`}>{CASE_TYPE_LABEL[item.type] || '案件'}</span>
                      <span className="badge bg-copper/12 text-copper">{pipelineStage}</span>
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
                <p className={`mt-2 text-xs ${item.nextFollowUpDate ? 'text-copper' : 'font-semibold text-gold'}`}>
                  {item.nextFollowUpDate ? `下次追蹤 ${dayjs(item.nextFollowUpDate).format('YYYY/MM/DD')}` : item.status === 'completed' ? '案件已完成' : '尚未設定下次追蹤日'}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {showNew && <NewCaseModal clients={clients} cats={cats} stages={stages} initialClientId={initialClientId} onClose={() => { setShowNew(false); onNewClosed?.(); }} onSaveCase={saveCase} onSaveClient={saveClient} onSaveWorkItem={saveWorkItem} onSaveActivity={saveActivity} onCreated={(id) => { setShowNew(false); onNewClosed?.(); setSelectedId(id); }} />}
      {selected && <CaseDetail item={selected} workItems={workItems} tasks={tasks} caseQueue={workQueue.filter((row) => row.caseId === selected.id)} activities={activities} deals={deals} quotes={quoteDrafts} onClose={() => setSelectedId(null)} onSaveCase={saveCase} onDeleteCase={deleteCase} onSaveWorkItem={saveWorkItem} onSaveActivity={saveActivity} onSaveTask={saveTask} onUpdateClient={updateClient} onOpenClient={onOpenClient} onOpenQuote={onOpenQuote} onOpenOperations={onOpenOperations} />}
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
  const [followUpMode, setFollowUpMode] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpAmount, setFollowUpAmount] = useState('');
  const [followUpUnit, setFollowUpUnit] = useState('days');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const nextFollowUpDate = resolveCaseFollowUpTarget({
    mode: followUpMode, date: followUpDate, amount: followUpAmount, unit: followUpUnit, baseDate: today(),
  });

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (!nextFollowUpDate) {
      setError('請先選擇下次追蹤日期，或設定幾天／幾週後追蹤。');
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
      title: title.trim() || (type === 'purchase' ? '買車案件' : '改裝案件'), source: 'manual', quoteIds: [], dealId: null,
      pipelineStage: 'new', lastContactAt: null,
      nextFollowUpDate, followUpPlanMode: followUpMode,
      followUpPlanBaseDate: followUpMode === 'relative' ? today() : null,
      followUpPlanAmount: followUpMode === 'relative' ? Number(followUpAmount) : null,
      followUpPlanUnit: followUpMode === 'relative' ? followUpUnit : null,
    });
    if (nextTitle.trim()) await onSaveWorkItem({ id: generateId('work'), caseId: id, clientId: client.id, clientName: client.name, title: nextTitle.trim(), due: nextFollowUpDate, state: 'todo' });
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
          </section>
          <section>
            <label className="section-title block px-0">4. 下次追蹤日 <span className="text-danger">＊必選</span></label>
            <p className="mt-1 text-xs text-ink-3">新案件先安排追蹤；成交後才會進入施工與交車排程。</p>
            <FollowUpTargetChooser mode={followUpMode} onModeChange={setFollowUpMode} date={followUpDate} onDateChange={setFollowUpDate} amount={followUpAmount} onAmountChange={setFollowUpAmount} unit={followUpUnit} onUnitChange={setFollowUpUnit} targetDate={nextFollowUpDate} />
          </section>
          {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</p>}
        </div>
      </form>
    </div>
  );
}

function FollowUpTargetChooser({ mode, onModeChange, date, onDateChange, amount, onAmountChange, unit, onUnitChange, targetDate }) {
  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onModeChange('date')} className={`min-h-14 rounded-xl border px-3 text-sm font-bold ${mode === 'date' ? 'border-copper bg-copper/12 text-copper' : 'border-bdr bg-s2 text-ink-2'}`}>📅 指定日期</button>
        <button type="button" onClick={() => onModeChange('relative')} className={`min-h-14 rounded-xl border px-3 text-sm font-bold ${mode === 'relative' ? 'border-copper bg-copper/12 text-copper' : 'border-bdr bg-s2 text-ink-2'}`}>⏳ 幾天／幾週後</button>
      </div>
      {mode === 'date' && (
        <label className="block text-[11px] font-medium text-ink-3">下次追蹤日期<input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} className="mt-1 min-h-12 w-full" /></label>
      )}
      {mode === 'relative' && (
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <label className="block text-[11px] font-medium text-ink-3">數量<input inputMode="numeric" value={amount} onChange={(event) => onAmountChange(event.target.value.replace(/[^0-9]/g, ''))} placeholder="例如 14" className="mt-1 min-h-12 w-full" /></label>
          <label className="block text-[11px] font-medium text-ink-3">單位<select value={unit} onChange={(event) => onUnitChange(event.target.value)} className="mt-1 min-h-12 w-full"><option value="days">天後</option><option value="weeks">週後</option></select></label>
        </div>
      )}
      {targetDate && <div className="rounded-xl border border-ok/35 bg-ok/10 px-3 py-2 text-sm font-bold text-ok">下次追蹤：{dayjs(targetDate).format('YYYY/MM/DD')}</div>}
    </div>
  );
}

function CasePipeline({ current }) {
  const currentIndex = Math.max(0, CASE_PIPELINE_STAGES.findIndex((stage) => stage.label === current));
  return (
    <section className="card p-3" aria-label="案件流程">
      <div className="grid grid-cols-5 gap-1">
        {CASE_PIPELINE_STAGES.map((stage, index) => <div key={stage.id} className="min-w-0 text-center"><div className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${index < currentIndex ? 'bg-ok text-on-accent' : index === currentIndex ? 'bg-copper text-on-accent ring-4 ring-copper/15' : 'bg-s3 text-ink-3'}`}>{index < currentIndex ? '✓' : index + 1}</div><p className={`mt-1 truncate text-[10px] font-bold ${index === currentIndex ? 'text-copper' : 'text-ink-3'}`}>{stage.label}</p></div>)}
      </div>
    </section>
  );
}

function CaseEditSheet({ item, currentPipeline = 'new', workItems = [], canDelete = true, onClose, onDeleted, onSaveCase, onDeleteCase, onSaveWorkItem, onSaveActivity }) {
  const [title, setTitle] = useState(item.title || '');
  const [type, setType] = useState(item.type || 'purchase');
  const [pipelineStage, setPipelineStage] = useState(currentPipeline);
  const [followUpMode, setFollowUpMode] = useState(item.nextFollowUpDate ? 'date' : '');
  const [followUpDate, setFollowUpDate] = useState(item.nextFollowUpDate || '');
  const [followUpAmount, setFollowUpAmount] = useState('');
  const [followUpUnit, setFollowUpUnit] = useState('days');
  const [followUpBaseDate, setFollowUpBaseDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const nextFollowUpDate = resolveCaseFollowUpTarget({
    mode: followUpMode, date: followUpDate, amount: followUpAmount, unit: followUpUnit, baseDate: followUpBaseDate,
  });

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    if (!title.trim()) { setError('請輸入案件名稱。'); return; }
    if (pipelineStage !== 'completed' && !nextFollowUpDate) { setError('請設定下一次追蹤日期。'); return; }
    setSaving(true);
    setError('');
    await onSaveCase({
      ...item, title: title.trim(), type, pipelineStage, status: pipelineStage === 'completed' ? 'completed' : 'active',
      nextFollowUpDate: pipelineStage === 'completed' ? '' : nextFollowUpDate,
      followUpPlanMode: pipelineStage === 'completed' ? null : followUpMode,
      followUpPlanBaseDate: pipelineStage !== 'completed' && followUpMode === 'relative' ? followUpBaseDate : null,
      followUpPlanAmount: pipelineStage !== 'completed' && followUpMode === 'relative' ? Number(followUpAmount) : null,
      followUpPlanUnit: pipelineStage !== 'completed' && followUpMode === 'relative' ? followUpUnit : null,
    });
    const nextWork = workItems.find((work) => work.state !== 'done');
    if (nextWork && pipelineStage !== 'completed' && nextFollowUpDate) {
      await onSaveWorkItem({ ...nextWork, due: nextFollowUpDate });
    }
    await onSaveActivity({
      id: generateId('activity'), caseId: item.id, clientId: item.clientId, clientName: item.clientName,
      type: 'case', text: `更新案件：${title.trim()}・${CASE_PIPELINE_STAGES.find((stage) => stage.id === pipelineStage)?.label}`, date: today(),
    });
    onClose();
  }

  async function removeCase() {
    if (deleting || !canDelete) return;
    setDeleting(true);
    setError('');
    try {
      await onDeleteCase(item.id);
      onDeleted?.();
    } catch (cause) {
      setError(cause?.message || '案件刪除失敗，請稍後再試。');
      setDeleting(false);
      setConfirmDelete(false);
    }
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
          <section><p className="text-xs font-bold text-ink-2">案件流程</p><div className="mt-2 grid grid-cols-2 gap-2">{CASE_PIPELINE_STAGES.map((stage) => <button key={stage.id} type="button" onClick={() => setPipelineStage(stage.id)} className={`min-h-11 rounded-xl border text-xs font-bold ${pipelineStage === stage.id ? 'border-accent bg-accent/12 text-accent' : 'border-bdr text-ink-2'}`}>{stage.label}</button>)}</div></section>
          {pipelineStage !== 'completed' && <section><p className="text-xs font-bold text-ink-2">下次追蹤日</p><p className="mt-1 text-xs text-ink-3">只會更新這一筆案件。</p><FollowUpTargetChooser mode={followUpMode} onModeChange={(nextMode) => { if (nextMode === 'relative' && followUpMode !== 'relative') setFollowUpBaseDate(today()); setFollowUpMode(nextMode); }} date={followUpDate} onDateChange={setFollowUpDate} amount={followUpAmount} onAmountChange={setFollowUpAmount} unit={followUpUnit} onUnitChange={setFollowUpUnit} targetDate={nextFollowUpDate} /></section>}
          {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</p>}
          <div className="grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="btn-outline min-h-12">取消</button><button type="submit" disabled={saving} className="btn-primary min-h-12">{saving ? '儲存中…' : '確認儲存案件'}</button></div>
          <section className="rounded-2xl border border-danger/30 bg-danger/5 p-3">
            <p className="text-sm font-bold text-danger">刪除廢棄案件</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-3">案件會移到「已刪除」；客戶、報價、工作與紀錄都會保留，可隨時恢復。</p>
            {!canDelete ? (
              <p className="mt-3 rounded-xl bg-s2 px-3 py-2 text-xs font-semibold text-ink-2">此案件已成交或進入施工，為避免施工資料斷線，不能從這裡刪除。</p>
            ) : !confirmDelete ? (
              <button type="button" onClick={() => setConfirmDelete(true)} className="mt-3 min-h-11 w-full rounded-xl border border-danger/50 text-sm font-bold text-danger">刪除案件</button>
            ) : (
              <div role="alert" className="mt-3 rounded-xl border border-danger/45 bg-s1 p-3">
                <p className="text-sm font-bold text-danger">確定刪除「{item.title || '未命名案件'}」？</p>
                <p className="mt-1 text-xs text-ink-3">刪除後會先從案件清單與工作台隱藏，可在「已刪除」恢復。</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} className="btn-outline min-h-11">先不要</button>
                  <button type="button" onClick={removeCase} disabled={deleting} className="btn-danger min-h-11">{deleting ? '刪除中…' : '確定刪除'}</button>
                </div>
              </div>
            )}
          </section>
        </div>
      </form>
    </div>
  );
}

function CaseDetail({ item, workItems, tasks, caseQueue, activities, deals, quotes, onClose, onSaveCase, onDeleteCase, onSaveWorkItem, onSaveActivity, onSaveTask, onUpdateClient, onOpenClient, onOpenQuote, onOpenOperations }) {
  const [newTitle, setNewTitle] = useState('');
  const [due, setDue] = useState('');
  const [section, setSection] = useState('overview');
  const [showEdit, setShowEdit] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contactResult, setContactResult] = useState('');
  const [contactNextDate, setContactNextDate] = useState(item.nextFollowUpDate || '');
  const [contactError, setContactError] = useState('');
  const [contactSaving, setContactSaving] = useState(false);
  const linkedDeal = deals.find((row) => row.id === item.dealId || row.caseId === item.id);
  const linkedQuotes = quotes.filter((row) => (item.quoteIds || []).includes(row.id) || row.caseId === item.id);
  const pipelineStage = getCasePipelineStage(item, { deals, quotes });
  const pipelineStageId = getCasePipelineStageId(item, { deals, quotes });
  const caseWork = workItems.filter((row) => row.caseId === item.id);
  // 施工工作由下方的案件施工卡統一處理，避免在「下一步」出現第二套完成入口。
  const pending = caseQueue.filter((row) => row.sourceType !== 'delivery');
  const actionablePending = pending.filter((row) => row.state !== 'waiting');
  const waitingPending = pending.filter((row) => row.state === 'waiting');
  const completed = caseWork.filter((row) => row.state === 'done');
  const timeline = activities.filter((row) => row.caseId === item.id).sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  const workflow = normalizeDeliveryWorkflow(linkedDeal);
  const schedule = buildDeliverySchedule(workflow);
  const completedStages = workflow.filter((step) => ['done', 'na'].includes(step.status)).length;
  const currentStage = getCurrentWorkflowStep(workflow);
  const currentTiming = currentStage ? getStageTiming(currentStage, workflow) : null;
  const blockedStages = workflow.filter((step) => step.status === 'blocked');
  const blockedStage = blockedStages[0] || null;
  const directNextStage = currentStage
    ? workflow.find((step) => !['done', 'na'].includes(step.status) && step.dependsOn === currentStage.id)
    : null;
  const nextStage = directNextStage || [...schedule.rows]
    .sort((a, b) => a.startOffset - b.startOffset)
    .find((step) => !['done', 'na'].includes(step.status) && step.id !== currentStage?.id && step.status !== 'blocked') || null;
  const workflowPercent = workflow.length ? Math.round(completedStages / workflow.length * 100) : 0;
  const workflowStart = linkedDeal?.deliveryWorkflowStartDate || linkedDeal?.date || '';
  const targetDate = workflowStart && schedule.totalDays ? dayjs(workflowStart).add(schedule.totalDays - 1, 'day').format('YYYY/MM/DD') : '';
  const followUpTiming = item.nextFollowUpDate
    ? dayjs(item.nextFollowUpDate).startOf('day').diff(dayjs().startOf('day'), 'day')
    : null;

  async function recordContact(event) {
    event.preventDefault();
    if (!contactResult.trim()) { setContactError('請填寫這次聯繫結果。'); return; }
    if (pipelineStageId !== 'completed' && !contactNextDate) { setContactError('請設定這筆案件的下次追蹤日。'); return; }
    setContactSaving(true);
    setContactError('');
    const timestamp = new Date().toISOString();
    try {
      await onSaveCase({
        ...item,
        lastContactAt: timestamp,
        nextFollowUpDate: pipelineStageId === 'completed' ? '' : contactNextDate,
        pipelineStage: pipelineStageId === 'new' ? 'follow_up' : pipelineStageId,
        updatedAt: timestamp,
      });
      await onSaveActivity({ id: generateId('activity'), caseId: item.id, clientId: item.clientId, clientName: item.clientName, type: 'contact', text: `聯繫：${contactResult.trim()}`, date: timestamp });
      setContactResult('');
      setShowContact(false);
    } catch (cause) {
      setContactError(cause?.message || '聯繫紀錄儲存失敗。');
    } finally {
      setContactSaving(false);
    }
  }

  async function addWork(event) {
    event.preventDefault();
    if (!newTitle.trim()) return;
    await onSaveWorkItem({ id: generateId('work'), caseId: item.id, clientId: item.clientId, clientName: item.clientName, title: newTitle.trim(), due, state: 'todo' });
    await onSaveActivity({ id: generateId('activity'), caseId: item.id, clientId: item.clientId, type: 'work', text: `新增工作：${newTitle.trim()}`, date: today() });
    setNewTitle('');
  }

  async function finishWork(row) {
    if (row.sourceType === 'delivery') {
      onOpenOperations?.(row.dealId, item.id);
      return;
    }
    if (row.sourceType === 'case-follow-up') {
      setContactNextDate(item.nextFollowUpDate || '');
      setShowContact(true);
      return;
    }
    if (row.sourceType === 'workItem') {
      const source = workItems.find((work) => work.id === row.sourceId);
      if (source) await onSaveWorkItem({ ...source, state: 'done', completedAt: new Date().toISOString() });
    } else if (row.sourceType === 'task') {
      const source = tasks.find((task) => task.id === row.sourceId);
      if (source) await onSaveTask({ ...source, done: true, doneAt: new Date().toISOString() });
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
            <p className="text-xs text-ink-3 truncate">{CASE_TYPE_LABEL[item.type]}・{item.title}・{pipelineStage}</p>
          </div>
          <button type="button" onClick={() => setShowEdit(true)} className="min-h-11 shrink-0 rounded-xl border border-copper/45 bg-copper/10 px-3 text-xs font-bold text-copper">✎ 編輯案件</button>
        </header>

        <div className="p-3 md:p-5 space-y-4 pb-28">
          <CasePipeline current={pipelineStage} />
          <section className="grid grid-cols-3 gap-2">
            <button type="button" disabled={!item.clientId} onClick={() => item.clientId && onOpenClient?.(item.clientId)} className="card min-h-16 px-2 py-3 text-xs font-bold text-accent disabled:opacity-40">👤 客戶資料</button>
            <button type="button" onClick={() => onOpenQuote?.(item, linkedQuotes[0]?.id || null)} className="card min-h-16 px-2 py-3 text-xs font-bold text-gold">🧾 {linkedQuotes.length ? `報價 ${linkedQuotes.length}` : '建立報價'}</button>
            <button type="button" disabled={!linkedDeal} onClick={() => linkedDeal && onOpenOperations?.(linkedDeal.id, item.id)} className="card min-h-16 px-2 py-3 text-xs font-bold text-copper disabled:opacity-40">🚚 {linkedDeal ? '施工進度' : '尚未成交'}</button>
          </section>

          <nav className="grid grid-cols-4 gap-1 rounded-xl border border-bdr bg-s1 p-1 sticky top-[3.9rem] z-10">
            {[['overview', '總覽'], ['work', '工作'], ['quotes', '報價'], ['history', '紀錄']].map(([key, label]) => <button key={key} type="button" onClick={() => setSection(key)} className={`min-h-10 rounded-lg text-xs font-bold ${section === key ? 'bg-teal text-on-accent' : 'text-ink-2'}`}>{label}</button>)}
          </nav>

          {section === 'overview' && (
            <section className={`card p-4 ${item.nextFollowUpDate ? 'border-copper/35' : item.status === 'completed' ? '' : 'border-gold/55 bg-gold/5'}`}>
              <div className="grid grid-cols-2 gap-3"><div><p className="text-[11px] font-bold text-teal">最近聯繫</p><p className="mt-1 text-base font-bold text-ink">{item.lastContactAt ? dayjs(item.lastContactAt).format('YYYY/MM/DD') : '尚未聯繫'}</p></div><div><p className="text-[11px] font-bold text-copper">下次追蹤</p><p className="mt-1 text-base font-bold text-ink">{item.nextFollowUpDate ? dayjs(item.nextFollowUpDate).format('YYYY/MM/DD') : item.status === 'completed' ? '案件已完成' : '尚未設定'}</p>{item.nextFollowUpDate && <p className={`mt-1 text-xs ${followUpTiming < 0 ? 'font-bold text-danger' : 'text-ink-3'}`}>{followUpTiming < 0 ? `已逾期 ${Math.abs(followUpTiming)} 天` : followUpTiming === 0 ? '今天需要追蹤' : `${followUpTiming} 天後追蹤`}</p>}</div></div>
              <button type="button" onClick={() => { setContactNextDate(item.nextFollowUpDate || ''); setShowContact(true); }} className="btn-primary mt-4 min-h-12 w-full">📞 記錄這筆案件的聯繫</button>
            </section>
          )}

          {(section === 'work' || (section === 'overview' && pending.length > 0)) && <section className="card p-4">
            <h2 className="font-bold text-ink">{workflow.length ? '其他待辦' : '下一步'}</h2>
            {pending.length === 0 ? <p className="text-sm text-ink-3 mt-3">尚未安排工作。</p> : <div className="space-y-2 mt-3">{actionablePending.map((row) => <div key={row.id} className="rounded-xl border border-bdr bg-s2 p-3 flex items-center gap-3"><button type="button" onClick={() => finishWork(row)} className={`w-11 h-11 rounded-full border-2 font-bold shrink-0 ${row.sourceType === 'delivery' ? 'border-copper text-copper' : 'border-ok text-ok'}`} aria-label={row.sourceType === 'delivery' ? `前往施工進度處理 ${row.title}` : `完成 ${row.title}`}>{row.sourceType === 'delivery' ? '→' : '✓'}</button><div className="min-w-0 flex-1"><p className="font-medium text-ink">{row.title}</p><p className="text-xs text-ink-3 mt-0.5">{row.sourceType === 'delivery' ? '前往施工進度確認後再變更狀態' : (row.due ? dayjs(row.due).format('YYYY/MM/DD') : '未排日期')}</p></div></div>)}{actionablePending.length === 0 && <p className="rounded-xl bg-s2 p-3 text-sm text-ink-3">目前工作都在等待前置階段。</p>}{waitingPending.length > 0 && <details className="rounded-xl border border-bdr bg-s2/50"><summary className="cursor-pointer px-3 py-3 text-xs font-bold text-ink-2">等待中的後續 {waitingPending.length} 項</summary><div className="space-y-2 border-t border-bdr px-3 py-3">{waitingPending.map((row) => <div key={row.id}><p className="text-sm text-ink">{row.title}</p><p className="text-[11px] text-ink-3">{row.waitingOn || '等待前置工作'}</p></div>)}</div></details>}</div>}
            <form onSubmit={addWork} className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="新增下一步…" className="min-h-11" />
              <button className="btn-primary min-h-11">加入</button>
              <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className="min-h-11 col-span-2" />
            </form>
          </section>}

          {section === 'overview' && workflow.length > 0 && (
            <section className="card overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-ink">施工進度</h2>
                    <p className="mt-0.5 text-[11px] text-ink-3">完成 {completedStages}/{workflow.length}・預計 {targetDate || '尚未設定'}</p>
                  </div>
                  <span className="rounded-full bg-ok/12 px-3 py-1 text-xs font-bold text-ok">{workflowPercent}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-s3"><div className="h-full rounded-full bg-ok" style={{ width: `${workflowPercent}%` }} /></div>

                <div className="mt-4 divide-y divide-bdr overflow-hidden rounded-2xl border border-bdr bg-s2/45">
                  <div className="grid grid-cols-[3.5rem_1fr] gap-3 p-3">
                    <p className="text-xs font-bold text-accent">現在</p>
                    <div><p className="text-sm font-bold text-ink">{currentStage?.label || '施工階段已完成'}</p><p className={`mt-1 text-xs ${currentTiming?.urgency === 'overdue' ? 'font-bold text-danger' : 'text-ink-3'}`}>{currentStage ? (currentTiming?.elapsedDays ? `已 ${currentTiming.elapsedDays} 天／原訂 ${currentTiming.plannedDays} 天${currentTiming.overDays ? `・超過 ${currentTiming.overDays} 天` : ''}` : '尚未開始計時') : '可準備正式交車'}</p></div>
                  </div>
                  <div className="grid grid-cols-[3.5rem_1fr] gap-3 p-3">
                    <p className={`text-xs font-bold ${blockedStage ? 'text-danger' : 'text-ok'}`}>卡點</p>
                    <div><p className="text-sm font-bold text-ink">{blockedStage ? `${blockedStage.label}：${blockedStage.blockedReason || '目前卡住'}` : '目前沒有卡住'}</p>{blockedStage && <p className="mt-1 text-xs text-ink-3">{[blockedStage.blockedOwner ? `等待 ${blockedStage.blockedOwner}` : '', blockedStage.blockedFollowUpDate ? `${dayjs(blockedStage.blockedFollowUpDate).format('MM/DD')} 再追` : '尚未設定追蹤日', blockedStages.length > 1 ? `另有 ${blockedStages.length - 1} 項卡住` : ''].filter(Boolean).join('・')}</p>}</div>
                  </div>
                  <div className="grid grid-cols-[3.5rem_1fr] gap-3 p-3">
                    <p className="text-xs font-bold text-copper">下一步</p>
                    <div><p className="text-sm font-bold text-ink">{nextStage?.label || (currentStage ? '完成目前階段後準備交車' : '確認正式交車')}</p><p className="mt-1 text-xs text-ink-3">{nextStage ? (getWaitingOn(nextStage, workflow) ? `等待：${getWaitingOn(nextStage, workflow).label}` : `預計 ${getStageTiming(nextStage, workflow).plannedDays} 天`) : '沒有其他施工階段'}</p></div>
                  </div>
                </div>

                <button type="button" onClick={() => onOpenOperations?.(linkedDeal.id, item.id)} className="btn-primary mt-4 min-h-12 w-full text-sm">處理現在進度</button>
              </div>
            </section>
          )}

          {(section === 'overview' || section === 'quotes') && <section className="card p-4"><div className="flex items-center justify-between"><h2 className="font-bold text-ink">案件報價與成交</h2><button type="button" onClick={() => onOpenQuote?.(item, null)} className="text-xs text-gold">＋ 新報價</button></div>{linkedQuotes.length === 0 && !linkedDeal && <p className="text-sm text-ink-3 mt-3">尚未建立報價或成交資料。</p>}{linkedQuotes.map((quote) => <button type="button" onClick={() => onOpenQuote?.(item, quote.id)} key={quote.id} className="mt-3 w-full flex items-center justify-between gap-3 text-left"><div><p className="text-sm text-ink">報價・{quote.model || '未填車型'}</p><p className="text-xs text-ink-3">{quote.date}</p></div><strong className="text-gold">NT$ {formatMoney(quote.total)} ›</strong></button>)}{linkedDeal && <button type="button" onClick={() => onOpenOperations?.(linkedDeal.id, item.id)} className="mt-3 w-full flex items-center justify-between gap-3 text-left"><div><p className="text-sm text-ink">成交・{linkedDeal.model || linkedDeal.note || '車輛'}</p><p className="text-xs text-ink-3">{linkedDeal.date}</p></div><strong className="text-copper">NT$ {formatMoney(linkedDeal.amount)} ›</strong></button>}</section>}

          {section === 'history' && <section className="card p-4"><h2 className="font-bold text-ink">案件紀錄</h2>{timeline.length === 0 ? <p className="text-sm text-ink-3 mt-3">目前沒有紀錄。</p> : <div className="mt-3 space-y-3">{timeline.map((row) => <div key={row.id} className="border-l-2 border-bdr pl-3"><p className="text-sm text-ink">{row.text}</p><p className="text-[11px] text-ink-3 mt-0.5">{dayjs(row.date || row.createdAt).format('YYYY/MM/DD HH:mm')}</p></div>)}</div>}</section>}
          {section === 'work' && completed.length > 0 && <details className="card p-4"><summary className="font-bold text-ink cursor-pointer">已完成工作 {completed.length} 項</summary><div className="mt-3 space-y-2">{completed.map((row) => <p key={row.id} className="text-sm text-ink-3 line-through">✓ {row.title}</p>)}</div></details>}
        </div>
        {showContact && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 md:items-center md:p-4"><form onSubmit={recordContact} className="w-full max-w-md rounded-t-3xl border border-bdr bg-s1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-panel md:rounded-2xl"><div className="flex items-center justify-between"><div><p className="text-xs font-bold text-teal">案件聯繫紀錄</p><h2 className="text-lg font-bold text-ink">{item.title}</h2></div><button type="button" onClick={() => setShowContact(false)} className="h-11 w-11 rounded-xl border border-bdr" aria-label="關閉">×</button></div><label className="mt-4 block text-xs font-bold text-ink-2">這次聯繫結果<textarea value={contactResult} onChange={(event) => setContactResult(event.target.value)} rows={3} placeholder="例：客戶確認要雙廂自排，等待貨款資料" className="mt-2 w-full resize-none" /></label>{pipelineStageId !== 'completed' && <label className="mt-4 block text-xs font-bold text-ink-2">下次追蹤日<input type="date" value={contactNextDate} onChange={(event) => setContactNextDate(event.target.value)} className="mt-2 min-h-12 w-full" /></label>}{contactError && <p role="alert" className="mt-3 rounded-xl bg-danger/10 p-3 text-sm text-danger">{contactError}</p>}<div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => setShowContact(false)} className="btn-outline min-h-12">取消</button><button type="submit" disabled={contactSaving} className="btn-primary min-h-12">{contactSaving ? '儲存中…' : '儲存聯繫紀錄'}</button></div></form></div>}
        {showEdit && <CaseEditSheet item={item} currentPipeline={pipelineStageId} workItems={caseWork} canDelete={!linkedDeal} onClose={() => setShowEdit(false)} onDeleted={() => { setShowEdit(false); onClose(); }} onSaveCase={onSaveCase} onDeleteCase={onDeleteCase} onSaveWorkItem={onSaveWorkItem} onSaveActivity={onSaveActivity} />}
      </div>
    </div>
  );
}

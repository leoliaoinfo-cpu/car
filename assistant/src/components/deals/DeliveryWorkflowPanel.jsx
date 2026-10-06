import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  activateAvailableWorkflowSteps, buildDeliverySchedule, DELIVERY_STATUS_OPTIONS, generateDeliveryWorkflow,
  getStageTiming, getWaitingOn, mergeSuggestedWorkflow, normalizeDeliveryWorkflow, updateWorkflowStepStatus,
} from '../../utils/delivery';

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const FINISHED_STATUSES = new Set(['done', 'na']);
const STATUS_STYLES = {
  todo: 'bg-s3 text-ink-2', contacted: 'bg-blue-500/12 text-blue-300', scheduled: 'bg-gold/15 text-gold',
  doing: 'bg-accent/15 text-accent', blocked: 'bg-danger/15 text-danger', done: 'bg-ok/15 text-ok', na: 'bg-s3 text-ink-3',
};

function progressStats(workflow, deal = {}) {
  const complete = workflow.filter((step) => FINISHED_STATUSES.has(step.status)).length;
  const active = workflow.filter((step) => !FINISHED_STATUSES.has(step.status));
  const current = active.find((step) => !getWaitingOn(step, workflow)) || active[0] || null;
  const timing = current ? getStageTiming(current, workflow) : null;
  const overdue = active.filter((step) => {
    const rowTiming = getStageTiming(step, workflow);
    return rowTiming.urgency === 'overdue' || (step.plannedDate && dayjs(step.plannedDate).isBefore(dayjs(), 'day'));
  }).length;
  const schedule = buildDeliverySchedule(workflow);
  const startedAt = deal.deliveryWorkflowStartDate || workflow.map((step) => step.activatedAt).filter(Boolean).sort()[0] || deal.date || '';
  const runningDays = startedAt ? Math.max(1, dayjs().startOf('day').diff(dayjs(startedAt).startOf('day'), 'day') + 1) : null;
  const targetDate = startedAt && schedule.totalDays ? dayjs(startedAt).add(schedule.totalDays - 1, 'day').format('YYYY-MM-DD') : '';
  return { complete, current, timing, overdue, schedule, startedAt, runningDays, targetDate, percent: workflow.length ? Math.round(complete / workflow.length * 100) : 0 };
}

export default function DeliveryWorkflowPanel({ deals, clients, pricingById, suppliers, onSaveDeal, onOpenPricing, focusDealId = null }) {
  const [openDealId, setOpenDealId] = useState(null);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [addStepDealId, setAddStepDealId] = useState(null);
  const [viewModeByDeal, setViewModeByDeal] = useState({});
  const [sortModeDealId, setSortModeDealId] = useState(null);
  const [newStep, setNewStep] = useState({ label: '', service: '' });
  const [deleteStepId, setDeleteStepId] = useState(null);
  const clientNames = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const supplierNames = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])), [suppliers]);
  const statusLabels = useMemo(() => new Map(DELIVERY_STATUS_OPTIONS), []);
  const sortedDeals = [...deals].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  useEffect(() => {
    const deal = focusDealId && deals.find((row) => row.id === focusDealId);
    if (!deal) return;
    const workflow = normalizeDeliveryWorkflow(deal);
    const current = progressStats(workflow, deal).current;
    setOpenDealId(focusDealId);
    if (current) setExpandedSteps((previous) => ({ ...previous, [`${deal.id}:${current.id}`]: true }));
  }, [focusDealId, deals]);

  function saveWorkflow(deal, workflow) {
    return onSaveDeal({
      ...deal,
      deliveryWorkflow: activateAvailableWorkflowSteps(workflow),
      deliveryWorkflowStartDate: deal.deliveryWorkflowStartDate || dayjs().format('YYYY-MM-DD'),
      deliveryWorkflowUpdatedAt: new Date().toISOString(),
    });
  }

  function updateStep(deal, workflow, stepId, patch) {
    const timestamp = new Date().toISOString();
    const next = Object.hasOwn(patch, 'status')
      ? updateWorkflowStepStatus(workflow, stepId, patch.status, timestamp)
      : workflow.map((step) => step.id === stepId ? { ...step, ...patch, updatedAt: timestamp } : step);
    saveWorkflow(deal, next);
  }

  function openDeal(deal, workflow, requestedStepId = null) {
    setOpenDealId(deal.id);
    const stepId = requestedStepId || progressStats(workflow, deal).current?.id;
    if (stepId) setExpandedSteps((previous) => ({ ...previous, [`${deal.id}:${stepId}`]: true }));
  }

  function toggleDeal(deal, workflow) {
    if (openDealId === deal.id) {
      setOpenDealId(null);
      setAddStepDealId(null);
      return;
    }
    setNewStep({ label: '', service: '' });
    openDeal(deal, workflow);
  }

  function toggleStep(dealId, stepId, defaultExpanded = false) {
    const key = `${dealId}:${stepId}`;
    setExpandedSteps((previous) => ({ ...previous, [key]: previous[key] == null ? !defaultExpanded : !previous[key] }));
  }

  function moveStep(deal, workflow, index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= workflow.length) return;
    const next = [...workflow];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    saveWorkflow(deal, next);
  }

  async function completeStep(deal, workflow, stepId) {
    const nextWorkflow = updateWorkflowStepStatus(workflow, stepId, 'done');
    await saveWorkflow(deal, nextWorkflow);
    const nextCurrent = progressStats(nextWorkflow, deal).current;
    setExpandedSteps((previous) => ({
      ...previous,
      [`${deal.id}:${stepId}`]: false,
      ...(nextCurrent ? { [`${deal.id}:${nextCurrent.id}`]: true } : {}),
    }));
  }

  function addStep(deal, workflow) {
    if (!newStep.label.trim()) return;
    const previous = workflow.at(-1);
    const added = {
      id: makeId(), label: newStep.label.trim(), service: newStep.service.trim() || '其他',
      dependsOn: previous?.id || null, status: 'todo', supplierId: '', plannedDate: '', cost: '', note: '',
      plannedDays: 1, activatedAt: null, completedAt: null, statusChangedAt: null,
    };
    saveWorkflow(deal, [...workflow, added]);
    setNewStep({ label: '', service: '' });
    setAddStepDealId(null);
    setExpandedSteps((current) => ({ ...current, [`${deal.id}:${added.id}`]: true }));
  }

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <h2 className="font-bold text-ink">🚚 成交後施工進度</h2>
        <p className="text-xs text-ink-3 mt-1">外層先看目前進度；需要調整時再展開單一步驟，完成項目不會一直占滿畫面。</p>
      </div>
      {sortedDeals.length === 0 && <p className="card p-6 text-center text-sm text-ink-3">尚無成交案件；建立成交案後即可安排施工。</p>}
      {sortedDeals.map((deal) => {
        const workflow = normalizeDeliveryWorkflow(deal);
        const stats = progressStats(workflow, deal);
        const pricing = pricingById.get(`deal:${deal.id}`);
        const isOpen = openDealId === deal.id;
        const currentWaiting = stats.current ? getWaitingOn(stats.current, workflow) : null;
        const viewMode = viewModeByDeal[deal.id] || 'steps';
        const isSortMode = sortModeDealId === deal.id;
        return (
          <section key={deal.id} className={`card overflow-hidden ${focusDealId === deal.id ? 'ring-2 ring-copper/40' : ''}`}>
            <button type="button" onClick={() => toggleDeal(deal, workflow)} aria-expanded={isOpen}
              className="w-full min-h-16 flex items-center gap-3 p-3 text-left">
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-s2 text-xs font-bold text-accent"
                style={{ background: workflow.length ? `conic-gradient(#7aa6bf ${stats.percent}%, rgba(148,163,184,.18) 0)` : undefined }}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-s1">{workflow.length ? `${stats.percent}%` : '＋'}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink truncate">{clientNames.get(deal.clientId) || deal.clientName || '未連結客戶'}・{deal.model || deal.note || '車輛'}</span>
                <span className="block text-[11px] text-ink-3">{deal.date ? dayjs(deal.date).format('YYYY/MM/DD') : '日期未填'}・{workflow.length ? `完成 ${stats.complete}/${workflow.length}` : '尚未建立流程'}</span>
                {stats.current && <span className="mt-1 block truncate text-[11px] text-accent">目前：{stats.current.label}</span>}
              </span>
              <span className="shrink-0 rounded-lg border border-bdr px-2 py-1 text-[11px] font-semibold text-ink-2">{isOpen ? '收合 ▲' : '摘要 ▼'}</span>
            </button>

            {workflow.length > 0 && (
              <div className="px-3 pb-3 space-y-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-s3"><div className="h-full rounded-full bg-ok transition-all" style={{ width: `${stats.percent}%` }} /></div>
                <div className="grid grid-cols-4 gap-1.5 text-center">
                  <div className="rounded-lg bg-s2 px-2 py-1.5"><p className="text-[10px] text-ink-3">待處理</p><p className="text-sm font-bold text-ink">{workflow.length - stats.complete}</p></div>
                  <div className="rounded-lg bg-s2 px-2 py-1.5"><p className="text-[10px] text-ink-3">已完成</p><p className="text-sm font-bold text-ok">{stats.complete}</p></div>
                  <div className="rounded-lg bg-s2 px-2 py-1.5"><p className="text-[10px] text-ink-3">逾期</p><p className={`text-sm font-bold ${stats.overdue ? 'text-danger' : 'text-ink-3'}`}>{stats.overdue}</p></div>
                  <div className="rounded-lg bg-s2 px-2 py-1.5"><p className="text-[10px] text-ink-3">總工期</p><p className="text-sm font-bold text-accent">{stats.schedule.totalDays || '—'}<small className="ml-0.5 text-[9px]">天</small></p></div>
                </div>
                {!isOpen && stats.current && (
                  <div className="rounded-xl border border-accent/25 bg-accent/8 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="text-[10px] font-bold text-accent">目前工作</p><p className="mt-0.5 truncate text-sm font-bold text-ink">{stats.current.label}</p><p className={`mt-0.5 text-[11px] ${stats.timing?.urgency === 'overdue' ? 'font-bold text-danger' : 'text-ink-3'}`}>{currentWaiting ? `等待：${currentWaiting.label}` : stats.timing?.elapsedDays ? `已停留 ${stats.timing.elapsedDays} 天／分配 ${stats.timing.plannedDays} 天${stats.timing.overDays ? `・超過 ${stats.timing.overDays} 天` : ''}` : '尚未開始計時'}</p></div>
                      <button type="button" onClick={() => openDeal(deal, workflow, stats.current.id)} className="btn-outline min-h-10 shrink-0 text-xs">設定</button>
                    </div>
                  </div>
                )}
                {!isOpen && (
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => openDeal(deal, workflow)} className="btn-primary min-h-11 text-xs">管理流程</button>
                    <button type="button" onClick={() => { openDeal(deal, workflow); setAddStepDealId(deal.id); }} className="btn-outline min-h-11 text-xs">＋工作</button>
                    <button type="button" onClick={() => onOpenPricing(deal)} className="btn-outline min-h-11 text-xs">成交配備</button>
                  </div>
                )}
              </div>
            )}

            {isOpen && (
              <div className="border-t border-bdr p-3 space-y-3">
                {workflow.length > 0 && (
                  <div className="rounded-xl border border-bdr bg-s2/50 p-3 space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div><p className="text-[10px] text-ink-3">預計總工期</p><p className="mt-0.5 text-lg font-bold text-accent">{stats.schedule.totalDays} 天</p></div>
                      <div><p className="text-[10px] text-ink-3">目前進行</p><p className="mt-0.5 text-sm font-bold text-ink">{stats.runningDays ? `第 ${stats.runningDays} 天` : '未開始'}</p></div>
                      <div><p className="text-[10px] text-ink-3">預計完成</p><p className="mt-0.5 text-sm font-bold text-ink">{stats.targetDate ? dayjs(stats.targetDate).format('MM/DD') : '尚未設定'}</p></div>
                    </div>
                    <label className="block text-[10px] text-ink-3">流程開始日<input type="date" value={deal.deliveryWorkflowStartDate || ''} onChange={(event) => onSaveDeal({ ...deal, deliveryWorkflowStartDate: event.target.value })} className="mt-1 min-h-11 w-full text-xs" /></label>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => saveWorkflow(deal, mergeSuggestedWorkflow(workflow, generateDeliveryWorkflow({ deal, pricing })))} className="btn-primary min-h-10 text-xs">
                    {workflow.length ? '＋ 補上建議步驟' : '依成交內容建立流程'}
                  </button>
                  <button type="button" onClick={() => onOpenPricing(deal)} className="btn-outline min-h-10 text-xs">成本與成交配備</button>
                  <button type="button" onClick={() => setAddStepDealId(addStepDealId === deal.id ? null : deal.id)} className="btn-outline min-h-10 text-xs">＋ 新增工作</button>
                  {workflow.length > 0 && <button type="button" onClick={() => setSortModeDealId(isSortMode ? null : deal.id)} className={`min-h-10 rounded-lg border px-3 text-xs font-bold ${isSortMode ? 'border-gold bg-gold/12 text-gold' : 'border-bdr text-ink-2'}`}>{isSortMode ? '完成排序' : '調整順序'}</button>}
                </div>
                {workflow.length > 0 && (
                  <div className="grid grid-cols-2 rounded-xl border border-bdr bg-s2 p-1" role="tablist" aria-label="施工流程顯示方式">
                    <button type="button" onClick={() => setViewModeByDeal((current) => ({ ...current, [deal.id]: 'steps' }))} className={`min-h-10 rounded-lg text-xs font-bold ${viewMode === 'steps' ? 'bg-s1 text-accent shadow-sm' : 'text-ink-3'}`}>直式步驟</button>
                    <button type="button" onClick={() => setViewModeByDeal((current) => ({ ...current, [deal.id]: 'timeline' }))} className={`min-h-10 rounded-lg text-xs font-bold ${viewMode === 'timeline' ? 'bg-s1 text-accent shadow-sm' : 'text-ink-3'}`}>排程圖</button>
                  </div>
                )}
                {workflow.length === 0 && <p className="rounded-lg bg-s2 p-3 text-xs text-ink-3">系統可從成交配備辨識尾門、帆布、烤漆、H 架或箱體；建立後仍可逐項調整。</p>}
                {viewMode === 'steps' && workflow.map((step, index) => {
                  const waiting = getWaitingOn(step, workflow);
                  const matchedSuppliers = suppliers.filter((supplier) => supplier.active !== false
                    && (!(supplier.services || []).length || (supplier.services || []).some((service) => step.service.includes(service) || service.includes(step.service))));
                  const supplierOptions = matchedSuppliers.length ? matchedSuppliers : suppliers.filter((supplier) => supplier.active !== false);
                  const stepKey = `${deal.id}:${step.id}`;
                  const expanded = expandedSteps[stepKey] ?? stats.current?.id === step.id;
                  const finished = FINISHED_STATUSES.has(step.status);
                  const supplierName = supplierNames.get(step.supplierId) || '未指派廠商';
                  const timing = getStageTiming(step, workflow);
                  return (
                    <article key={step.id} className={`overflow-hidden rounded-xl border ${waiting ? 'border-gold/45 bg-gold/5' : stats.current?.id === step.id ? 'border-accent/45 bg-accent/5' : 'border-bdr bg-s2/35'}`}>
                      <button type="button" onClick={() => toggleStep(deal.id, step.id, stats.current?.id === step.id)} aria-expanded={expanded} className="w-full p-3 text-left">
                        <div className="flex items-start gap-2.5">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${finished ? 'bg-ok text-on-accent' : waiting ? 'bg-gold/15 text-gold' : 'bg-accent/12 text-accent'}`}>{finished ? '✓' : index + 1}</span>
                          <div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink">{step.label}</p><div className="mt-1 flex flex-wrap gap-1.5 text-[10px]"><span className={`rounded-full px-2 py-0.5 font-bold ${STATUS_STYLES[step.status]}`}>{statusLabels.get(step.status)}</span><span className="rounded-full bg-s3 px-2 py-0.5 text-ink-3">{supplierName}</span><span className={`rounded-full px-2 py-0.5 ${timing.urgency === 'overdue' ? 'bg-danger/12 font-bold text-danger' : 'bg-s3 text-ink-3'}`}>{timing.elapsedDays ? `${timing.elapsedDays}/${timing.plannedDays} 天` : `分配 ${timing.plannedDays} 天`}</span>{step.cost !== '' && <span className="rounded-full bg-s3 px-2 py-0.5 text-ink-3">NT$ {Number(step.cost).toLocaleString('zh-TW')}</span>}</div>{waiting && <p className="mt-1 text-[10px] text-gold">等待「{waiting.label}」完成</p>}</div>
                          {isSortMode ? <span className="flex shrink-0 gap-1"><span onClick={(event) => { event.stopPropagation(); moveStep(deal, workflow, index, -1); }} role="button" tabIndex={0} aria-label={`上移${step.label}`} className={`flex h-10 w-9 items-center justify-center rounded-lg border border-bdr ${index === 0 ? 'pointer-events-none opacity-30' : ''}`}>↑</span><span onClick={(event) => { event.stopPropagation(); moveStep(deal, workflow, index, 1); }} role="button" tabIndex={0} aria-label={`下移${step.label}`} className={`flex h-10 w-9 items-center justify-center rounded-lg border border-bdr ${index === workflow.length - 1 ? 'pointer-events-none opacity-30' : ''}`}>↓</span></span> : <span className="shrink-0 text-xs text-ink-3">{expanded ? '▲' : '▼'}</span>}
                        </div>
                      </button>
                      {expanded && (
                        <div className="border-t border-bdr/60 p-3 space-y-3">
                          <div className="grid grid-cols-[1fr_auto] gap-2">
                            <select value={step.status} onChange={(event) => updateStep(deal, workflow, step.id, { status: event.target.value })} aria-label={`${step.label}狀態`} className="min-h-11 text-xs">
                              {DELIVERY_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                            {!finished && <button type="button" onClick={() => completeStep(deal, workflow, step.id)} className="btn-outline min-h-11 px-3 text-xs text-ok">✓ 完成</button>}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <label className="text-[10px] text-ink-3">施工廠商<select value={step.supplierId || ''} onChange={(event) => updateStep(deal, workflow, step.id, { supplierId: event.target.value })} aria-label={`${step.label}廠商`} className="mt-1 min-h-11 w-full text-xs"><option value="">未指派廠商</option>{supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
                            <label className="text-[10px] text-ink-3">預計日期<input type="date" value={step.plannedDate || ''} onChange={(event) => updateStep(deal, workflow, step.id, { plannedDate: event.target.value })} className="mt-1 min-h-11 w-full text-xs" /></label>
                            <label className="text-[10px] text-ink-3">分配天數<input inputMode="numeric" value={step.plannedDays || 1} onChange={(event) => updateStep(deal, workflow, step.id, { plannedDays: Math.max(1, Number(event.target.value.replace(/[^0-9]/g, '')) || 1) })} className="mt-1 min-h-11 w-full text-xs" /></label>
                            <label className="text-[10px] text-ink-3">成本／廠商報價<input inputMode="numeric" value={step.cost ?? ''} onChange={(event) => updateStep(deal, workflow, step.id, { cost: event.target.value.replace(/[^0-9]/g, '') })} placeholder="尚未確認" className="mt-1 min-h-11 w-full text-xs" /></label>
                            <label className="text-[10px] text-ink-3">前置工作<select value={step.dependsOn || ''} onChange={(event) => updateStep(deal, workflow, step.id, { dependsOn: event.target.value || null })} className="mt-1 min-h-11 w-full text-xs"><option value="">可獨立／可同時進行</option>{workflow.filter((candidate) => candidate.id !== step.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label>
                          </div>
                          <textarea value={step.note || ''} onChange={(event) => updateStep(deal, workflow, step.id, { note: event.target.value })} rows={2} placeholder="聯繫結果、施工地址、注意事項或進度備註" className="w-full text-xs" />
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex gap-1"><button type="button" disabled={index === 0} onClick={() => moveStep(deal, workflow, index, -1)} className="btn-outline min-h-10 px-3 text-xs disabled:opacity-30">↑ 上移</button><button type="button" disabled={index === workflow.length - 1} onClick={() => moveStep(deal, workflow, index, 1)} className="btn-outline min-h-10 px-3 text-xs disabled:opacity-30">↓ 下移</button></div>
                            {deleteStepId === step.id ? <span className="flex gap-2"><button type="button" onClick={() => setDeleteStepId(null)} className="btn-outline min-h-10 text-xs">取消</button><button type="button" onClick={() => { saveWorkflow(deal, workflow.filter((row) => row.id !== step.id).map((row) => row.dependsOn === step.id ? { ...row, dependsOn: null } : row)); setDeleteStepId(null); }} className="btn-danger min-h-10 text-xs">確認刪除</button></span> : <button type="button" onClick={() => setDeleteStepId(step.id)} className="min-h-10 px-2 text-xs text-danger/70">刪除工作</button>}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
                {viewMode === 'timeline' && workflow.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1 text-[10px] text-ink-3"><span>流程起點</span><span>第 {stats.schedule.totalDays} 天完成</span></div>
                    {stats.schedule.rows.map((row, index) => {
                      const timing = getStageTiming(row, workflow);
                      const waiting = getWaitingOn(row, workflow);
                      const left = stats.schedule.totalDays ? row.startOffset / stats.schedule.totalDays * 100 : 0;
                      const width = stats.schedule.totalDays ? row.plannedDays / stats.schedule.totalDays * 100 : 100;
                      return <article key={row.id} className={`rounded-xl border p-3 ${stats.current?.id === row.id ? 'border-accent/50 bg-accent/5' : 'border-bdr bg-s2/35'}`}>
                        <div className="flex items-start gap-2"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${FINISHED_STATUSES.has(row.status) ? 'bg-ok text-on-accent' : 'bg-s3 text-ink-2'}`}>{FINISHED_STATUSES.has(row.status) ? '✓' : index + 1}</span><div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink">{row.label}</p><p className={`mt-0.5 text-[11px] ${timing.urgency === 'overdue' ? 'font-bold text-danger' : 'text-ink-3'}`}>{waiting ? `等待：${waiting.label}` : timing.elapsedDays ? `實際 ${timing.elapsedDays} 天／分配 ${timing.plannedDays} 天${timing.overDays ? `・超過 ${timing.overDays} 天` : ''}` : `分配 ${timing.plannedDays} 天`}</p></div>{isSortMode && <span className="flex shrink-0 gap-1"><button type="button" disabled={index === 0} onClick={() => moveStep(deal, workflow, index, -1)} className="h-10 w-9 rounded-lg border border-bdr disabled:opacity-30">↑</button><button type="button" disabled={index === workflow.length - 1} onClick={() => moveStep(deal, workflow, index, 1)} className="h-10 w-9 rounded-lg border border-bdr disabled:opacity-30">↓</button></span>}</div>
                        <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-s3"><div className={`absolute top-0 h-full rounded-full ${timing.urgency === 'overdue' ? 'bg-danger' : FINISHED_STATUSES.has(row.status) ? 'bg-ok' : 'bg-accent'}`} style={{ left: `${left}%`, width: `${Math.max(width, 3)}%` }} /></div>
                        <div className="mt-1 flex justify-between text-[9px] text-ink-3"><span>第 {row.startOffset + 1} 天</span><span>第 {row.endOffset} 天</span></div>
                      </article>;
                    })}
                  </div>
                )}
                {addStepDealId === deal.id && (
                  <div className="rounded-xl border-2 border-dashed border-accent/40 bg-accent/5 p-3">
                    <div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold text-ink">新增自訂工作</p><button type="button" onClick={() => setAddStepDealId(null)} className="btn-ghost min-h-10 px-3 text-xs">收起</button></div>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-2"><input value={newStep.label} onChange={(event) => setNewStep((current) => ({ ...current, label: event.target.value }))} placeholder="例如：安裝冷凍機" className="min-h-11 text-xs" /><input value={newStep.service} onChange={(event) => setNewStep((current) => ({ ...current, service: event.target.value }))} placeholder="工作類型" className="min-h-11 text-xs" /><button type="button" onClick={() => addStep(deal, workflow)} className="btn-primary min-h-11 text-xs">加入流程</button></div>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

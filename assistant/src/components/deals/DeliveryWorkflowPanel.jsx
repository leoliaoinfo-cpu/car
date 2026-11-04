import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  activateAvailableWorkflowSteps, alignWorkflowOrderToDependencies, buildDeliverySchedule, DELIVERY_STATUS_OPTIONS, generateDeliveryWorkflow,
  createWorkflowRestorePoint, findWorkflowCycleIds, getCurrentWorkflowStep, getStageTiming, getWaitingOn,
  mergeSuggestedWorkflow, normalizeDeliveryWorkflow, planWorkflowStatusChange, reorderWorkflow,
  restoreWorkflowChange, updateWorkflowStepStatus, wouldCreateCycle,
} from '../../utils/delivery';

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const FINISHED_STATUSES = new Set(['done', 'na']);
const STATUS_STYLES = {
  todo: 'bg-s3 text-ink-2', contacted: 'bg-blue-500/12 text-blue-300', scheduled: 'bg-gold/15 text-gold',
  doing: 'bg-accent/15 text-accent', blocked: 'bg-danger/15 text-danger', done: 'bg-ok/15 text-ok', na: 'bg-s3 text-ink-3',
};
const STATUS_LABELS = new Map(DELIVERY_STATUS_OPTIONS);

function cloneWorkflow(workflow) {
  return (workflow || []).map((step) => ({ ...step }));
}

function ConfirmActionDialog({ action, busy, onCancel, onConfirm, onActionChange }) {
  if (!action) return null;
  const missingBlockDetails = action.requiresBlockDetails
    && (!String(action.blockReason || '').trim() || !action.blockFollowUpDate);
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="delivery-confirm-title">
      <button type="button" className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={busy ? undefined : onCancel} aria-label="取消並關閉" />
      <section className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-bdr bg-s1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-panel sm:rounded-2xl">
        <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-bdr sm:hidden" />
        <div className="flex items-start gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl ${action.tone === 'danger' ? 'bg-danger/15 text-danger' : 'bg-accent/15 text-accent'}`}>{action.icon || '✓'}</span>
          <div className="min-w-0 flex-1">
            <h2 id="delivery-confirm-title" className="text-lg font-bold text-ink">{action.title}</h2>
            {action.description && <p className="mt-1 text-sm leading-6 text-ink-2">{action.description}</p>}
          </div>
        </div>
        {!!action.effects?.length && (
          <div className="mt-4 rounded-xl border border-bdr bg-s2/70 p-3">
            <p className="text-xs font-bold text-ink">確認後會：</p>
            <ol className="mt-2 space-y-2 text-sm text-ink-2">
              {action.effects.map((effect, index) => <li key={`${effect}-${index}`} className="flex gap-2"><span className="font-bold text-accent">{index + 1}.</span><span>{effect}</span></li>)}
            </ol>
          </div>
        )}
        {action.requiresBlockDetails && (
          <div className="mt-4 space-y-3 rounded-xl border border-danger/35 bg-danger/5 p-3">
            <div><p className="text-sm font-bold text-ink">卡在哪裡？</p><p className="mt-0.5 text-xs text-ink-3">留下原因與追蹤日，之後打開案件就能直接看到。</p></div>
            <label className="block text-xs font-bold text-ink-2">卡住原因（必填）<textarea value={action.blockReason || ''} onChange={(event) => onActionChange({ blockReason: event.target.value })} rows={3} placeholder="例如：等待廠商確認施工日期" className="mt-1 w-full text-sm font-normal" /></label>
            <label className="block text-xs font-bold text-ink-2">目前在等誰<input value={action.blockOwner || ''} onChange={(event) => onActionChange({ blockOwner: event.target.value })} placeholder="例如：力新帆布、客戶回覆" className="mt-1 min-h-11 w-full text-sm font-normal" /></label>
            <label className="block text-xs font-bold text-ink-2">哪一天再追（必填）<input type="date" value={action.blockFollowUpDate || ''} onChange={(event) => onActionChange({ blockFollowUpDate: event.target.value })} className="mt-1 min-h-11 w-full text-sm font-normal" /></label>
          </div>
        )}
        {action.error && <p role="alert" className="mt-3 rounded-xl border border-danger/45 bg-danger/10 p-3 text-sm font-semibold text-danger">{action.error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="btn-outline min-h-12 disabled:opacity-50">取消</button>
          <button type="button" disabled={busy || missingBlockDetails} onClick={onConfirm} className={`${action.tone === 'danger' ? 'btn-danger' : 'btn-primary'} min-h-12 disabled:opacity-50`}>{busy ? '儲存中…' : action.confirmLabel || '確認'}</button>
        </div>
      </section>
    </div>
  );
}

function UndoToast({ action, busy, onUndo, onDismiss }) {
  if (!action) return null;
  return (
    <div className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[110] mx-auto max-w-lg rounded-2xl border border-ok/35 bg-s1 p-3 shadow-panel" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ok/15 text-lg text-ok">✓</span>
        <div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink">{action.message}</p><p className={`mt-0.5 text-[11px] ${action.error ? 'font-bold text-danger' : 'text-ink-3'}`}>{action.error || '操作已記錄，可立即恢復。'}</p></div>
        <button type="button" disabled={busy} onClick={onUndo} className="min-h-11 rounded-xl border border-accent/40 px-3 text-sm font-bold text-accent disabled:opacity-50">{busy ? '恢復中…' : '復原'}</button>
        <button type="button" onClick={onDismiss} className="h-11 w-11 rounded-xl text-lg text-ink-3" aria-label="關閉提示">×</button>
      </div>
    </div>
  );
}

function StageSwitcher({ workflow, selectedStep, onSelect }) {
  const complete = workflow.filter((step) => FINISHED_STATUSES.has(step.status)).length;
  return (
    <section className="rounded-2xl border border-bdr bg-s2/55 p-3" aria-label="施工階段切換">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-bold text-ink">階段切換</p><p className="mt-0.5 text-[10px] text-ink-3">點選可處理的階段，等待中的階段會先鎖住。</p></div>
        <span className="shrink-0 rounded-full bg-s1 px-2.5 py-1 text-[10px] font-bold text-accent">完成 {complete}/{workflow.length}</span>
      </div>
      <div className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1">
        {workflow.map((step, index) => {
          const finished = FINISHED_STATUSES.has(step.status);
          const waiting = getWaitingOn(step, workflow);
          const selected = selectedStep?.id === step.id;
          const disabled = finished || Boolean(waiting);
          const stateLabel = finished ? '已完成' : waiting ? `等待 ${waiting.label}` : selected ? '目前查看' : step.status === 'blocked' ? '卡住' : '可處理';
          return (
            <button key={step.id} type="button" disabled={disabled} onClick={() => onSelect(step.id)} aria-current={selected ? 'step' : undefined}
              className={`min-h-16 min-w-[148px] snap-start rounded-xl border px-3 py-2 text-left transition ${selected ? 'border-accent bg-accent/12 ring-1 ring-accent/25' : finished ? 'border-ok/25 bg-ok/8' : waiting ? 'border-bdr bg-s1/45 opacity-55' : step.status === 'blocked' ? 'border-danger/35 bg-danger/5' : 'border-bdr bg-s1'}`}>
              <span className={`block text-[10px] font-bold ${selected ? 'text-accent' : finished ? 'text-ok' : waiting ? 'text-ink-3' : step.status === 'blocked' ? 'text-danger' : 'text-copper'}`}>{index + 1}. {stateLabel}</span>
              <span className="mt-1 block truncate text-xs font-bold text-ink">{step.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function progressStats(workflow, deal = {}) {
  const complete = workflow.filter((step) => FINISHED_STATUSES.has(step.status)).length;
  const active = workflow.filter((step) => !FINISHED_STATUSES.has(step.status));
  const current = getCurrentWorkflowStep(workflow);
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

export default function DeliveryWorkflowPanel({ deals, cases = [], clients, pricingById, suppliers, onSaveDeal, onOpenPricing, onOpenClient, focusDealId = null }) {
  const [openDealId, setOpenDealId] = useState(null);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [addStepDealId, setAddStepDealId] = useState(null);
  const [workspaceModeByDeal, setWorkspaceModeByDeal] = useState({});
  const [viewModeByDeal, setViewModeByDeal] = useState({});
  const [sortModeDealId, setSortModeDealId] = useState(null);
  const [sortDrafts, setSortDrafts] = useState({});
  const [dragState, setDragState] = useState(null);
  const [stepDrafts, setStepDrafts] = useState({});
  const [stepNameDrafts, setStepNameDrafts] = useState({});
  const [saveErrors, setSaveErrors] = useState({});
  const [saveStatusByDeal, setSaveStatusByDeal] = useState({});
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [undoAction, setUndoAction] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [showCompletedByDeal, setShowCompletedByDeal] = useState({});
  const [showHistoryByDeal, setShowHistoryByDeal] = useState({});
  const [activeStepByDeal, setActiveStepByDeal] = useState({});
  const [timelineEditKey, setTimelineEditKey] = useState(null);
  const sortDraftsRef = useRef({});
  const dragStateRef = useRef(null);
  const stepDraftsRef = useRef({});
  const draftTimersRef = useRef({});
  const workflowRefs = useRef({});
  const workflowVersionRefs = useRef({});
  const dealRefs = useRef({});
  const saveQueuesRef = useRef({});
  const eventRefs = useRef({});
  const persistedWorkflowRefs = useRef({});
  const persistedEventRefs = useRef({});
  const persistedVersionRefs = useRef({});
  const [newStep, setNewStep] = useState({ label: '', service: '', plannedDays: '1', dependsOn: '' });
  const clientNames = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const caseNumbers = useMemo(() => {
    const map = new Map();
    cases.forEach((item) => {
      if (item.dealId) map.set(`deal:${item.dealId}`, item.caseNumber);
      map.set(`case:${item.id}`, item.caseNumber);
    });
    return map;
  }, [cases]);
  const supplierNames = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])), [suppliers]);
  const sortedDeals = (focusDealId ? deals.filter((deal) => deal.id === focusDealId) : [...deals])
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  deals.forEach((deal) => {
    dealRefs.current[deal.id] = deal;
    const incomingVersion = deal.deliveryWorkflowUpdatedAt || '';
    if (!workflowRefs.current[deal.id] || incomingVersion >= (workflowVersionRefs.current[deal.id] || '')) {
      const incomingWorkflow = normalizeDeliveryWorkflow(deal);
      const incomingEvents = Array.isArray(deal.deliveryWorkflowEvents) ? deal.deliveryWorkflowEvents : [];
      workflowRefs.current[deal.id] = incomingWorkflow;
      workflowVersionRefs.current[deal.id] = incomingVersion;
      eventRefs.current[deal.id] = incomingEvents;
      persistedWorkflowRefs.current[deal.id] = incomingWorkflow;
      persistedEventRefs.current[deal.id] = incomingEvents;
      persistedVersionRefs.current[deal.id] = incomingVersion;
    }
  });

  useEffect(() => () => {
    Object.values(draftTimersRef.current).forEach((timer) => clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (!undoAction) return undefined;
    const timer = setTimeout(() => setUndoAction(null), 12000);
    return () => clearTimeout(timer);
  }, [undoAction]);

  useEffect(() => {
    const deal = focusDealId && deals.find((row) => row.id === focusDealId);
    if (!deal) return;
    const workflow = normalizeDeliveryWorkflow(deal);
    setOpenDealId(focusDealId);
    setWorkspaceModeByDeal((current) => ({ ...current, [focusDealId]: 'daily' }));
  }, [focusDealId, deals]);

  function latestWorkflow(deal) {
    return workflowRefs.current[deal.id] || normalizeDeliveryWorkflow(deal);
  }

  async function saveWorkflow(deal, workflow, { event = null, events = null } = {}) {
    const timestamp = new Date().toISOString();
    const nextWorkflow = activateAvailableWorkflowSteps(workflow, timestamp);
    const currentEvents = events || eventRefs.current[deal.id] || deal.deliveryWorkflowEvents || [];
    const nextEvents = event ? [event, ...currentEvents].slice(0, 60) : currentEvents;
    workflowRefs.current[deal.id] = nextWorkflow;
    workflowVersionRefs.current[deal.id] = timestamp;
    eventRefs.current[deal.id] = nextEvents;
    setSaveStatusByDeal((current) => ({ ...current, [deal.id]: 'saving' }));
    const previousSave = saveQueuesRef.current[deal.id] || Promise.resolve();
    const saveTask = previousSave.catch(() => {}).then(() => {
      const currentDeal = dealRefs.current[deal.id] || deal;
      return Promise.resolve(onSaveDeal({
        ...currentDeal,
        deliveryWorkflow: nextWorkflow,
        deliveryWorkflowEvents: nextEvents,
        deliveryWorkflowStartDate: currentDeal.deliveryWorkflowStartDate || dayjs().format('YYYY-MM-DD'),
        deliveryWorkflowUpdatedAt: timestamp,
      }));
    });
    saveQueuesRef.current[deal.id] = saveTask;
    try {
      const saved = await saveTask;
      setSaveErrors((current) => {
        if (!current[deal.id]) return current;
        const next = { ...current };
        delete next[deal.id];
        return next;
      });
      if (saveQueuesRef.current[deal.id] === saveTask) {
        setSaveStatusByDeal((current) => ({ ...current, [deal.id]: 'saved' }));
      }
      persistedWorkflowRefs.current[deal.id] = nextWorkflow;
      persistedEventRefs.current[deal.id] = nextEvents;
      persistedVersionRefs.current[deal.id] = timestamp;
      return saved;
    } catch (error) {
      if (workflowRefs.current[deal.id] === nextWorkflow) {
        workflowRefs.current[deal.id] = persistedWorkflowRefs.current[deal.id] || normalizeDeliveryWorkflow(deal);
        eventRefs.current[deal.id] = persistedEventRefs.current[deal.id] || [];
        workflowVersionRefs.current[deal.id] = persistedVersionRefs.current[deal.id] || deal.deliveryWorkflowUpdatedAt || '';
      }
      setSaveErrors((current) => ({
        ...current,
        [deal.id]: error?.message || '施工流程儲存失敗，請稍後再試。',
      }));
      setSaveStatusByDeal((current) => ({ ...current, [deal.id]: 'error' }));
      return null;
    } finally {
      if (saveQueuesRef.current[deal.id] === saveTask) delete saveQueuesRef.current[deal.id];
    }
  }

  function updateStep(deal, stepId, patch) {
    const workflow = latestWorkflow(deal);
    const timestamp = new Date().toISOString();
    const next = Object.hasOwn(patch, 'status')
      ? updateWorkflowStepStatus(workflow, stepId, patch.status, timestamp)
      : workflow.map((step) => step.id === stepId ? { ...step, ...patch, updatedAt: timestamp } : step);
    workflowRefs.current[deal.id] = next;
    return saveWorkflow(deal, next);
  }

  function workflowEvent({ type, action, step, beforeWorkflow, afterWorkflow, fromStatus = null, toStatus = null, detail = '' }) {
    return {
      id: makeId(), type, action, stepId: step?.id || null, stepLabel: step?.label || '',
      fromStatus, toStatus, detail, createdAt: new Date().toISOString(), revertedAt: null,
      restorePoint: createWorkflowRestorePoint(beforeWorkflow, afterWorkflow),
    };
  }

  function requestStatusChange(deal, stepId, nextStatus) {
    const workflow = latestWorkflow(deal);
    const step = workflow.find((candidate) => candidate.id === stepId);
    if (!step || step.status === nextStatus) return;
    const preview = planWorkflowStatusChange(workflow, stepId, nextStatus);
    const nextLabel = STATUS_LABELS.get(nextStatus) || nextStatus;
    const previousLabel = STATUS_LABELS.get(step.status) || step.status;
    const effects = [
      `將狀態從「${previousLabel}」改為「${nextLabel}」`,
      `記錄這次進度變更的日期與時間`,
    ];
    if (preview.newlyAvailable.length) {
      effects.push(`啟動下一階段：${preview.newlyAvailable.map((candidate) => candidate.label).join('、')}`);
    }
    if (FINISHED_STATUSES.has(step.status) && !FINISHED_STATUSES.has(nextStatus)) {
      effects.push('已經開始的後續工作不會被刪除或清空');
    }
    if (nextStatus === 'blocked') {
      effects.push('保存卡住原因、等待對象與下次追蹤日');
    }
    setConfirmAction({
      title: `確認將「${step.label}」改為${nextLabel}？`,
      description: preview.newlyAvailable.length > 1 ? `此操作會同時啟動 ${preview.newlyAvailable.length} 個可並行工作。` : '確認後會更新案件進度。',
      effects,
      confirmLabel: nextStatus === 'done' ? '確認完成' : `確認${nextLabel}`,
      tone: nextStatus === 'na' || nextStatus === 'blocked' ? 'danger' : 'default',
      icon: nextStatus === 'done' ? '✓' : nextStatus === 'blocked' ? '!' : '→',
      requiresBlockDetails: nextStatus === 'blocked',
      blockReason: nextStatus === 'blocked' ? (step.blockedReason || '') : '',
      blockOwner: nextStatus === 'blocked' ? (step.blockedOwner || supplierNames.get(step.supplierId) || '') : '',
      blockFollowUpDate: nextStatus === 'blocked' ? (step.blockedFollowUpDate || dayjs().add(1, 'day').format('YYYY-MM-DD')) : '',
      perform: async (confirmedAction) => {
        const currentWorkflow = latestWorkflow(deal);
        const currentStep = currentWorkflow.find((candidate) => candidate.id === stepId);
        if (!currentStep || currentStep.status === nextStatus) return true;
        const plan = planWorkflowStatusChange(currentWorkflow, stepId, nextStatus);
        const nextWorkflow = nextStatus === 'blocked'
          ? plan.nextWorkflow.map((candidate) => candidate.id === stepId ? {
            ...candidate,
            blockedReason: String(confirmedAction.blockReason || '').trim(),
            blockedOwner: String(confirmedAction.blockOwner || '').trim(),
            blockedFollowUpDate: confirmedAction.blockFollowUpDate || '',
          } : candidate)
          : plan.nextWorkflow;
        const blockDetail = nextStatus === 'blocked'
          ? [String(confirmedAction.blockReason || '').trim(), confirmedAction.blockOwner ? `等待 ${confirmedAction.blockOwner}` : '', confirmedAction.blockFollowUpDate ? `${confirmedAction.blockFollowUpDate} 再追` : ''].filter(Boolean).join('・')
          : '';
        const event = workflowEvent({
          type: 'status', action: `將「${currentStep.label}」改為${nextLabel}`,
          step: currentStep, beforeWorkflow: plan.beforeWorkflow, afterWorkflow: nextWorkflow,
          fromStatus: currentStep.status, toStatus: nextStatus,
          detail: [blockDetail, plan.newlyAvailable.length ? `啟動：${plan.newlyAvailable.map((candidate) => candidate.label).join('、')}` : ''].filter(Boolean).join('・'),
        });
        const saved = await saveWorkflow(deal, nextWorkflow, { event });
        if (!saved) return false;
        const nextFocus = FINISHED_STATUSES.has(nextStatus) ? getCurrentWorkflowStep(nextWorkflow) : nextWorkflow.find((candidate) => candidate.id === stepId);
        setActiveStepByDeal((current) => ({ ...current, [deal.id]: nextFocus?.id || null }));
        setUndoAction({
          dealId: deal.id,
          eventId: event.id,
          message: FINISHED_STATUSES.has(nextStatus)
            ? `「${currentStep.label}」已完成${nextFocus ? `，現在進入「${nextFocus.label}」` : '，施工階段全部完成'}`
            : event.action,
        });
        if (FINISHED_STATUSES.has(nextStatus)) {
          setExpandedSteps((current) => ({ ...current, [`${deal.id}:${stepId}`]: false }));
        }
        return true;
      },
    });
  }

  function requestBlockedDetailsEdit(deal, stepId) {
    const workflow = latestWorkflow(deal);
    const step = workflow.find((candidate) => candidate.id === stepId);
    if (!step || step.status !== 'blocked') return;
    setConfirmAction({
      title: `修改「${step.label}」的卡點？`,
      description: '更新後，案件三行摘要與今天提醒會一起同步。',
      effects: ['更新卡住原因與等待對象', '依新的日期安排下次追蹤', '保留原進度與一筆可復原紀錄'],
      confirmLabel: '確認更新', tone: 'danger', icon: '✎', requiresBlockDetails: true,
      blockReason: step.blockedReason || '',
      blockOwner: step.blockedOwner || supplierNames.get(step.supplierId) || '',
      blockFollowUpDate: step.blockedFollowUpDate || dayjs().add(1, 'day').format('YYYY-MM-DD'),
      perform: async (confirmedAction) => {
        const currentWorkflow = latestWorkflow(deal);
        const currentStep = currentWorkflow.find((candidate) => candidate.id === stepId);
        if (!currentStep || currentStep.status !== 'blocked') {
          setSaveErrors((current) => ({ ...current, [deal.id]: '此階段已不再是卡住狀態，未修改卡點資料。' }));
          return false;
        }
        const timestamp = new Date().toISOString();
        const nextWorkflow = currentWorkflow.map((candidate) => candidate.id === stepId ? {
          ...candidate,
          blockedReason: String(confirmedAction.blockReason || '').trim(),
          blockedOwner: String(confirmedAction.blockOwner || '').trim(),
          blockedFollowUpDate: confirmedAction.blockFollowUpDate || '',
          updatedAt: timestamp,
        } : candidate);
        const detail = [
          String(confirmedAction.blockReason || '').trim(),
          confirmedAction.blockOwner ? `等待 ${confirmedAction.blockOwner}` : '',
          confirmedAction.blockFollowUpDate ? `${confirmedAction.blockFollowUpDate} 再追` : '',
        ].filter(Boolean).join('・');
        const event = workflowEvent({
          type: 'blocked-details', action: `更新「${currentStep.label}」卡點`, step: currentStep,
          beforeWorkflow: currentWorkflow, afterWorkflow: nextWorkflow, detail,
        });
        const saved = await saveWorkflow(deal, nextWorkflow, { event });
        if (!saved) return false;
        setUndoAction({ dealId: deal.id, eventId: event.id, message: event.action });
        return true;
      },
    });
  }

  function requestDependencyChange(deal, stepId, nextDependsOn) {
    const workflow = latestWorkflow(deal);
    const step = workflow.find((candidate) => candidate.id === stepId);
    if (!step || (step.dependsOn || null) === (nextDependsOn || null)) return;
    if (wouldCreateCycle(workflow, stepId, nextDependsOn)) {
      setSaveErrors((current) => ({ ...current, [deal.id]: '這個前置工作會形成循環，未進行修改。' }));
      return;
    }
    const previous = workflow.find((candidate) => candidate.id === step.dependsOn);
    const next = workflow.find((candidate) => candidate.id === nextDependsOn);
    setConfirmAction({
      title: `確認修改「${step.label}」的前置工作？`,
      description: `由「${previous?.label || '可獨立進行'}」改為「${next?.label || '可獨立進行'}」。`,
      effects: ['把這個階段排到前置工作之後，畫面順序同步更新', '重新判定等待狀態並計算施工起點與總工期', '不會刪除任何既有進度或備註'],
      confirmLabel: '確認修改', icon: '↳',
      perform: async () => {
        const currentWorkflow = latestWorkflow(deal);
        if (wouldCreateCycle(currentWorkflow, stepId, nextDependsOn)) {
          setSaveErrors((current) => ({ ...current, [deal.id]: '資料已變更，這個選項現在會形成循環，未進行修改。' }));
          return false;
        }
        const currentStep = currentWorkflow.find((candidate) => candidate.id === stepId);
        if (!currentStep) return true;
        const timestamp = new Date().toISOString();
        const changed = currentWorkflow.map((candidate) => candidate.id === stepId
          ? { ...candidate, dependsOn: nextDependsOn || null, updatedAt: timestamp }
          : candidate);
        const aligned = alignWorkflowOrderToDependencies(changed);
        const event = workflowEvent({
          type: 'dependency', action: `修改「${currentStep.label}」的前置工作`,
          step: currentStep, beforeWorkflow: currentWorkflow, afterWorkflow: aligned,
          detail: `${previous?.label || '可獨立進行'} → ${next?.label || '可獨立進行'}`,
        });
        const saved = await saveWorkflow(deal, aligned, { event });
        if (!saved) return false;
        setUndoAction({ dealId: deal.id, eventId: event.id, message: event.action });
        return true;
      },
    });
  }

  function requestDeleteStep(deal, stepId) {
    const workflow = latestWorkflow(deal);
    const step = workflow.find((candidate) => candidate.id === stepId);
    if (!step) return;
    const affected = workflow.filter((candidate) => candidate.dependsOn === stepId);
    setConfirmAction({
      title: `確認刪除「${step.label}」？`,
      description: '這是重大變更；刪除後仍可從下方提示或進度紀錄復原。',
      effects: [
        '從施工流程移除此工作',
        affected.length ? `將 ${affected.map((candidate) => candidate.label).join('、')} 改為可獨立進行` : '其他工作的前置關係不受影響',
        '保留一筆可追溯的刪除紀錄',
      ],
      confirmLabel: '確認刪除', tone: 'danger', icon: '!',
      perform: async () => {
        const currentWorkflow = latestWorkflow(deal);
        const currentStep = currentWorkflow.find((candidate) => candidate.id === stepId);
        if (!currentStep) return true;
        const next = currentWorkflow
          .filter((candidate) => candidate.id !== stepId)
          .map((candidate) => candidate.dependsOn === stepId ? { ...candidate, dependsOn: null } : candidate);
        const event = workflowEvent({
          type: 'delete', action: `刪除「${currentStep.label}」`, step: currentStep,
          beforeWorkflow: currentWorkflow, afterWorkflow: next,
          detail: affected.length ? `解除前置：${affected.map((candidate) => candidate.label).join('、')}` : '',
        });
        const saved = await saveWorkflow(deal, next, { event });
        if (!saved) return false;
        setUndoAction({ dealId: deal.id, eventId: event.id, message: event.action });
        return true;
      },
    });
  }

  async function restoreWorkflowEvent(deal, event) {
    if (!event?.restorePoint && !event?.beforeWorkflow?.length) return false;
    const now = new Date().toISOString();
    const currentWorkflow = latestWorkflow(deal);
    const restoredWorkflow = event.restorePoint
      ? restoreWorkflowChange(currentWorkflow, event.restorePoint)
      : cloneWorkflow(event.beforeWorkflow);
    const existingEvents = eventRefs.current[deal.id] || [];
    const markedEvents = existingEvents.map((candidate) => candidate.id === event.id ? { ...candidate, revertedAt: now } : candidate);
    const restoreEvent = workflowEvent({
      type: 'restore', action: `復原：${event.action}`, step: { id: event.stepId, label: event.stepLabel },
      beforeWorkflow: currentWorkflow, afterWorkflow: restoredWorkflow,
      detail: `只恢復 ${dayjs(event.createdAt).format('MM/DD HH:mm')} 這次操作變更的內容`,
    });
    const saved = await saveWorkflow(deal, restoredWorkflow, { events: [restoreEvent, ...markedEvents].slice(0, 60) });
    if (!saved) return false;
    setActiveStepByDeal((current) => ({ ...current, [deal.id]: getCurrentWorkflowStep(restoredWorkflow)?.id || null }));
    setUndoAction(null);
    return true;
  }

  function requestRestoreEvent(deal, event) {
    setConfirmAction({
      title: `確認復原「${event.action}」？`,
      description: '只恢復這次操作改動的內容；操作後新增的備註、成本與廠商資料會保留。',
      effects: ['恢復這次操作改動的狀態或前置關係', '重新計算目前工作與預計工期', '保留後續新增的其他施工資料'],
      confirmLabel: '確認復原', tone: 'danger', icon: '↶',
      perform: () => restoreWorkflowEvent(deal, event),
    });
  }

  async function performConfirmedAction() {
    if (!confirmAction?.perform || confirmBusy) return;
    const action = confirmAction;
    if (action.requiresBlockDetails && (!String(action.blockReason || '').trim() || !action.blockFollowUpDate)) {
      setConfirmAction((current) => current ? { ...current, error: '請先填寫卡住原因與下次追蹤日。' } : current);
      return;
    }
    setConfirmAction((current) => current ? { ...current, error: null } : current);
    setConfirmBusy(true);
    try {
      const completed = await action.perform(action);
      if (completed !== false) setConfirmAction(null);
      else setConfirmAction((current) => current ? { ...current, error: '儲存失敗，尚未確認這次變更。請再試一次，或取消後查看錯誤內容。' } : current);
    } catch (error) {
      setConfirmAction((current) => current ? { ...current, error: error?.message || '操作失敗，請稍後再試。' } : current);
    } finally {
      setConfirmBusy(false);
    }
  }

  async function performUndo() {
    if (!undoAction || undoBusy) return;
    const deal = dealRefs.current[undoAction.dealId];
    const event = (eventRefs.current[undoAction.dealId] || []).find((candidate) => candidate.id === undoAction.eventId);
    if (!deal || !event) {
      setUndoAction(null);
      return;
    }
    setUndoBusy(true);
    try {
      const restored = await restoreWorkflowEvent(deal, event);
      if (!restored) setUndoAction((current) => current ? { ...current, error: '復原失敗，原操作仍保留。請稍後再試。' } : current);
    } catch (error) {
      setUndoAction((current) => current ? { ...current, error: error?.message || '復原失敗，原操作仍保留。' } : current);
    } finally {
      setUndoBusy(false);
    }
  }

  function setStepDraftValue(deal, stepId, field, value) {
    const key = `${deal.id}:${stepId}`;
    const nextDraft = { ...(stepDraftsRef.current[key] || {}), [field]: value };
    stepDraftsRef.current = { ...stepDraftsRef.current, [key]: nextDraft };
    setStepDrafts(stepDraftsRef.current);
    clearTimeout(draftTimersRef.current[key]);
    draftTimersRef.current[key] = setTimeout(() => flushStepDraft(deal, stepId), 600);
  }

  function flushStepDraft(deal, stepId) {
    const key = `${deal.id}:${stepId}`;
    clearTimeout(draftTimersRef.current[key]);
    delete draftTimersRef.current[key];
    const draft = stepDraftsRef.current[key];
    if (!draft || !Object.keys(draft).length) return Promise.resolve(null);
    const patch = { ...draft };
    if (Object.hasOwn(patch, 'plannedDays')) patch.plannedDays = Math.max(1, Number(patch.plannedDays) || 1);
    const nextDrafts = { ...stepDraftsRef.current };
    delete nextDrafts[key];
    stepDraftsRef.current = nextDrafts;
    setStepDrafts(nextDrafts);
    return updateStep(deal, stepId, patch);
  }

  function openDeal(deal, workflow, requestedStepId = null, mode = 'daily') {
    setOpenDealId(deal.id);
    setWorkspaceModeByDeal((current) => ({ ...current, [deal.id]: mode }));
    if (requestedStepId && mode === 'plan') {
      setExpandedSteps((previous) => ({ ...previous, [`${deal.id}:${requestedStepId}`]: true }));
    }
  }

  function openStepEditor(deal, stepId) {
    setWorkspaceModeByDeal((current) => ({ ...current, [deal.id]: 'plan' }));
    setViewModeByDeal((current) => ({ ...current, [deal.id]: 'steps' }));
    setExpandedSteps((current) => ({ ...current, [`${deal.id}:${stepId}`]: true }));
  }

  function toggleDeal(deal, workflow) {
    if (openDealId === deal.id) {
      setOpenDealId(null);
      setAddStepDealId(null);
      return;
    }
    setNewStep({ label: '', service: '', plannedDays: '1', dependsOn: '' });
    openDeal(deal, workflow, null, 'daily');
  }

  function openAddStep(deal, workflow) {
    const current = latestWorkflow(deal) || workflow;
    setNewStep({ label: '', service: '', plannedDays: '1', dependsOn: current.at(-1)?.id || '' });
    setAddStepDealId(deal.id);
  }

  async function saveStepName(deal, step) {
    const key = `${deal.id}:${step.id}`;
    const label = String(stepNameDrafts[key] ?? step.label).trim();
    if (!label || label === step.label) return;
    const saved = await updateStep(deal, step.id, { label });
    if (saved) setStepNameDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function toggleStep(dealId, stepId, defaultExpanded = false) {
    const key = `${dealId}:${stepId}`;
    setExpandedSteps((previous) => ({ ...previous, [key]: previous[key] == null ? !defaultExpanded : !previous[key] }));
  }

  function setSortDraft(dealId, workflow) {
    const next = { ...sortDraftsRef.current, [dealId]: workflow };
    sortDraftsRef.current = next;
    setSortDrafts(next);
  }

  function toggleSortMode(deal, workflow, enabled) {
    if (!enabled) {
      setSortModeDealId(null);
      setDragState(null);
      dragStateRef.current = null;
      return;
    }
    setSortModeDealId(deal.id);
    setViewModeByDeal((current) => ({ ...current, [deal.id]: 'steps' }));
    setSortDraft(deal.id, workflow);
    setEveryStepCollapsed(deal.id, workflow);
  }

  function setEveryStepCollapsed(dealId, workflow) {
    setExpandedSteps((previous) => ({
      ...previous,
      ...Object.fromEntries(workflow.map((step) => [`${dealId}:${step.id}`, false])),
    }));
  }

  async function moveStepByKeyboard(deal, workflow, stepId, direction) {
    const index = workflow.findIndex((step) => step.id === stepId);
    const target = workflow[index + direction];
    if (!target) return;
    const reordered = reorderWorkflow(workflow, stepId, target.id);
    setSortDraft(deal.id, reordered);
    await saveWorkflow(deal, reordered);
  }

  function startDragging(event, deal, workflow, stepId) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (!sortDraftsRef.current[deal.id]) setSortDraft(deal.id, workflow);
    const nextDragState = { dealId: deal.id, stepId, overId: stepId, pointerId: event.pointerId };
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
  }

  function dragStep(event, deal) {
    const activeDrag = dragStateRef.current;
    if (!activeDrag || activeDrag.dealId !== deal.id || activeDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (event.clientY < 110) window.scrollBy({ top: -16, behavior: 'auto' });
    if (event.clientY > window.innerHeight - 110) window.scrollBy({ top: 16, behavior: 'auto' });
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-sort-step-id]');
    const targetId = target?.dataset?.sortStepId;
    if (!targetId || target?.dataset?.sortDealId !== deal.id || targetId === activeDrag.overId) return;
    const current = sortDraftsRef.current[deal.id] || [];
    const reordered = reorderWorkflow(current, activeDrag.stepId, targetId);
    setSortDraft(deal.id, reordered);
    const nextDragState = { ...activeDrag, overId: targetId };
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
  }

  async function finishDragging(event, deal) {
    const activeDrag = dragStateRef.current;
    if (!activeDrag || activeDrag.dealId !== deal.id || activeDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const reordered = sortDraftsRef.current[deal.id];
    dragStateRef.current = null;
    setDragState(null);
    if (reordered) await saveWorkflow(deal, reordered);
  }

  function cancelDragging(deal, workflow) {
    dragStateRef.current = null;
    setDragState(null);
    setSortDraft(deal.id, latestWorkflow(deal) || workflow);
  }

  function completeStep(deal, stepId) {
    requestStatusChange(deal, stepId, 'done');
  }

  function addStep(deal, workflow) {
    if (!newStep.label.trim()) return;
    const currentWorkflow = latestWorkflow(deal) || workflow;
    const added = {
      id: makeId(), label: newStep.label.trim(), service: newStep.service.trim() || '其他',
      dependsOn: newStep.dependsOn || null, status: 'todo', supplierId: '', plannedDate: '', cost: '', note: '',
      plannedDays: Math.max(1, Number(newStep.plannedDays) || 1), activatedAt: null, completedAt: null, statusChangedAt: null,
    };
    saveWorkflow(deal, [...currentWorkflow, added]);
    setNewStep({ label: '', service: '', plannedDays: '1', dependsOn: '' });
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
        const workflow = latestWorkflow(deal);
        const stats = progressStats(workflow, deal);
        const pricing = pricingById.get(`deal:${deal.id}`);
        const isOpen = openDealId === deal.id;
        const currentWaiting = stats.current ? getWaitingOn(stats.current, workflow) : null;
        const workspaceMode = workspaceModeByDeal[deal.id] || 'daily';
        const viewMode = viewModeByDeal[deal.id] || 'steps';
        const isSortMode = sortModeDealId === deal.id;
        const displayWorkflow = isSortMode && sortDrafts[deal.id]?.length ? sortDrafts[deal.id] : workflow;
        const cycleIds = findWorkflowCycleIds(displayWorkflow);
        const cycleLabels = displayWorkflow.filter((step) => cycleIds.has(step.id)).map((step) => step.label);
        const completedSteps = displayWorkflow.filter((step) => FINISHED_STATUSES.has(step.status));
        const showCompleted = showCompletedByDeal[deal.id] === true;
        const visibleWorkflow = isSortMode || showCompleted
          ? displayWorkflow
          : displayWorkflow.filter((step) => !FINISHED_STATUSES.has(step.status));
        const workflowEvents = eventRefs.current[deal.id] || deal.deliveryWorkflowEvents || [];
        const saveStatus = saveStatusByDeal[deal.id];
        const caseNumber = caseNumbers.get(`deal:${deal.id}`) || caseNumbers.get(`case:${deal.caseId}`);
        const unfinished = workflow.filter((step) => !FINISHED_STATUSES.has(step.status));
        const requestedDailyStep = unfinished.find((step) => step.id === activeStepByDeal[deal.id] && !getWaitingOn(step, workflow));
        const dailyStep = requestedDailyStep || stats.current;
        const dailyTiming = dailyStep ? getStageTiming(dailyStep, workflow) : null;
        const dailySupplierName = dailyStep ? supplierNames.get(dailyStep.supplierId) || '尚未指派廠商' : '';
        const blockedSteps = unfinished.filter((step) => step.status === 'blocked');
        const otherBlockedSteps = blockedSteps.filter((step) => step.id !== dailyStep?.id);
        const parallelSteps = unfinished.filter((step) => step.id !== dailyStep?.id && step.status !== 'blocked' && !getWaitingOn(step, workflow));
        const dependentNext = dailyStep
          ? unfinished.filter((step) => step.dependsOn === dailyStep.id)
          : [];
        const nextSteps = (dependentNext.length ? dependentNext : stats.schedule.rows
          .filter((step) => !FINISHED_STATUSES.has(step.status) && step.id !== dailyStep?.id)
          .sort((a, b) => a.startOffset - b.startOffset)).slice(0, 3);
        return (
          <section key={deal.id} className={`card overflow-hidden ${focusDealId === deal.id ? 'ring-2 ring-copper/40' : ''}`}>
            <button type="button" onClick={() => toggleDeal(deal, workflow)} aria-expanded={isOpen}
              className="w-full min-h-16 flex items-center gap-3 p-3 text-left">
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-s2 text-xs font-bold text-accent"
                style={{ background: workflow.length ? `conic-gradient(#7aa6bf ${stats.percent}%, rgba(148,163,184,.18) 0)` : undefined }}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-s1">{workflow.length ? `${stats.percent}%` : '＋'}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink truncate">{caseNumber ? `#${caseNumber}・` : ''}{clientNames.get(deal.clientId) || deal.clientName || '未連結客戶'}・{deal.model || deal.note || '車輛'}</span>
                <span className="block text-[11px] text-ink-3">{deal.date ? dayjs(deal.date).format('YYYY/MM/DD') : '日期未填'}・{workflow.length ? `完成 ${stats.complete}/${workflow.length}` : '尚未建立流程'}{saveStatus === 'saving' ? '・儲存中…' : saveStatus === 'saved' ? '・已儲存' : saveStatus === 'error' ? '・儲存失敗' : ''}</span>
                {stats.current && <span className="mt-1 block truncate text-[11px] text-accent">目前：{stats.current.label}</span>}
              </span>
              <span className="shrink-0 rounded-lg border border-bdr px-2 py-1 text-[11px] font-semibold text-ink-2">{isOpen ? '收合 ▲' : '摘要 ▼'}</span>
            </button>

            {workflow.length > 0 && (
              <div className="space-y-3 px-3 pb-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-s3"><div className="h-full rounded-full bg-ok transition-all" style={{ width: `${stats.percent}%` }} /></div>
                {!isOpen && stats.current && (
                  <div className={`rounded-xl border p-3 ${stats.timing?.urgency === 'overdue' ? 'border-danger/40 bg-danger/5' : stats.current.status === 'blocked' ? 'border-warn/45 bg-warn/5' : 'border-accent/30 bg-accent/5'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold text-accent">現在要處理</p>
                        <p className="mt-1 text-base font-bold text-ink">{stats.current.label}</p>
                        <p className={`mt-1 text-xs ${stats.timing?.urgency === 'overdue' ? 'font-bold text-danger' : 'text-ink-3'}`}>{currentWaiting ? `等待：${currentWaiting.label}` : stats.timing?.elapsedDays ? `已進行 ${stats.timing.elapsedDays} 天／原訂 ${stats.timing.plannedDays} 天${stats.timing.overDays ? `・超過 ${stats.timing.overDays} 天` : ''}` : '尚未開始計時'}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${STATUS_STYLES[stats.current.status]}`}>{STATUS_LABELS.get(stats.current.status)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
                      <span>剩下 {workflow.length - stats.complete} 項</span>
                      <span className={stats.overdue || blockedSteps.length ? 'font-bold text-danger' : ''}>{blockedSteps.length ? `卡住 ${blockedSteps.length} 項` : stats.overdue ? `逾期 ${stats.overdue} 項` : '目前無逾期'}</span>
                      <span>預計 {stats.targetDate ? dayjs(stats.targetDate).format('MM/DD') : '尚未排完成日'}</span>
                    </div>
                  </div>
                )}
                {!isOpen && !stats.current && <p className="rounded-xl bg-ok/10 p-3 text-center text-sm font-bold text-ok">✓ 所有施工階段都已完成</p>}
                {!isOpen && (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => openDeal(deal, workflow, null, 'daily')} className="btn-primary min-h-12 text-sm">處理目前進度</button>
                    <button type="button" onClick={() => { openDeal(deal, workflow, null, 'plan'); setViewModeByDeal((current) => ({ ...current, [deal.id]: 'timeline' })); }} className="btn-outline min-h-12 text-sm">查看完整排程</button>
                  </div>
                )}
              </div>
            )}

            {isOpen && (
              <div className="border-t border-bdr p-3 space-y-3">
                {saveErrors[deal.id] && (
                  <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-danger/55 bg-danger/10 p-3 text-xs text-danger">
                    <p><strong>儲存失敗：</strong>{saveErrors[deal.id]}</p>
                    <button type="button" onClick={() => setSaveErrors((current) => ({ ...current, [deal.id]: '' }))} className="min-h-11 min-w-11 shrink-0 rounded-lg border border-danger/40 px-2">關閉</button>
                  </div>
                )}
                {cycleIds.size > 0 && (
                  <div role="alert" className="rounded-xl border border-danger/55 bg-danger/10 p-3 text-xs leading-5 text-danger">
                    <p className="font-bold">⚠ 前置工作形成循環</p>
                    <p className="mt-1">涉及：{cycleLabels.join('、')}。原資料已保留，請展開步驟重新選擇前置工作。</p>
                  </div>
                )}
                <div className="grid grid-cols-2 rounded-xl border border-bdr bg-s2 p-1" role="tablist" aria-label="施工案件操作模式">
                  <button type="button" onClick={() => { setWorkspaceModeByDeal((current) => ({ ...current, [deal.id]: 'daily' })); toggleSortMode(deal, workflow, false); }} className={`min-h-11 rounded-lg text-sm font-bold ${workspaceMode === 'daily' ? 'bg-s1 text-accent shadow-sm' : 'text-ink-3'}`}>現在要做什麼</button>
                  <button type="button" onClick={() => setWorkspaceModeByDeal((current) => ({ ...current, [deal.id]: 'plan' }))} className={`min-h-11 rounded-lg text-sm font-bold ${workspaceMode === 'plan' ? 'bg-s1 text-copper shadow-sm' : 'text-ink-3'}`}>排程與設定</button>
                </div>

                {workspaceMode === 'daily' && (
                  <div className="space-y-3">
                    {workflow.length > 0 && <StageSwitcher workflow={workflow} selectedStep={dailyStep} onSelect={(stepId) => setActiveStepByDeal((current) => ({ ...current, [deal.id]: stepId }))} />}
                    {workflow.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-accent/40 bg-accent/5 p-4 text-center">
                        <p className="font-bold text-ink">這筆成交還沒有施工流程</p>
                        <p className="mt-1 text-xs leading-5 text-ink-3">系統可以依成交配備建立尾門、帆布、烤漆、箱體、洗車與交車步驟。</p>
                        <button type="button" onClick={() => saveWorkflow(deal, generateDeliveryWorkflow({ deal, pricing }))} className="btn-primary mt-4 min-h-12 w-full">依成交內容建立流程</button>
                      </div>
                    ) : dailyStep ? (
                      <>
                        <section className={`rounded-2xl border-2 p-4 ${dailyStep.status === 'blocked' ? 'border-danger/45 bg-danger/5' : dailyTiming?.urgency === 'overdue' ? 'border-warn/55 bg-warn/5' : 'border-accent/40 bg-accent/5'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-bold tracking-[.12em] text-accent">目前查看・第 {workflow.findIndex((step) => step.id === dailyStep.id) + 1} 階段</p>
                              <h3 className="mt-1 text-xl font-bold text-ink">{dailyStep.label}</h3>
                            </div>
                            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${STATUS_STYLES[dailyStep.status]}`}>{STATUS_LABELS.get(dailyStep.status)}</span>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-2">
                            <div className="rounded-xl bg-s1/75 p-3"><p className="text-[10px] text-ink-3">進行時間</p><p className={`mt-1 text-sm font-bold ${dailyTiming?.urgency === 'overdue' ? 'text-danger' : 'text-ink'}`}>{dailyTiming?.elapsedDays ? `${dailyTiming.elapsedDays} 天／原訂 ${dailyTiming.plannedDays} 天` : '尚未開始'}</p>{dailyTiming?.overDays > 0 && <p className="mt-1 text-[11px] font-bold text-danger">已超過 {dailyTiming.overDays} 天</p>}</div>
                            <div className="rounded-xl bg-s1/75 p-3"><p className="text-[10px] text-ink-3">施工廠商</p><p className="mt-1 text-sm font-bold text-ink">{dailySupplierName}</p></div>
                          </div>
                          {dailyStep.note && <p className="mt-3 rounded-xl bg-s1/75 px-3 py-2 text-xs leading-5 text-ink-2">{dailyStep.note}</p>}
                          {dailyStep.status === 'blocked' && (
                            <div className="mt-3 rounded-xl border border-danger/30 bg-s1/80 p-3">
                              <p className="text-xs font-bold text-danger">{dailyStep.blockedReason || '此階段目前卡住'}</p>
                              <p className="mt-1 text-[11px] text-ink-3">{[dailyStep.blockedOwner ? `等待 ${dailyStep.blockedOwner}` : '', dailyStep.blockedFollowUpDate ? `${dayjs(dailyStep.blockedFollowUpDate).format('MM/DD')} 再追` : '尚未設定追蹤日'].filter(Boolean).join('・')}</p>
                              <button type="button" onClick={() => requestBlockedDetailsEdit(deal, dailyStep.id)} className="mt-2 min-h-11 w-full rounded-lg border border-danger/35 text-xs font-bold text-danger">✎ 修改卡點／追蹤日</button>
                            </div>
                          )}
                          <div className="mt-4 grid grid-cols-2 gap-2">
                            {dailyStep.status !== 'doing' && <button type="button" onClick={() => requestStatusChange(deal, dailyStep.id, 'doing')} className="btn-primary min-h-12 text-sm">{dailyStep.status === 'blocked' ? '▶ 恢復處理' : '▶ 開始處理'}</button>}
                            <button type="button" onClick={() => completeStep(deal, dailyStep.id)} className="min-h-12 rounded-xl bg-ok px-3 text-sm font-bold text-on-accent">✓ 完成此階段</button>
                            {dailyStep.status !== 'blocked' && <button type="button" onClick={() => requestStatusChange(deal, dailyStep.id, 'blocked')} className="min-h-12 rounded-xl border border-danger/40 px-3 text-sm font-bold text-danger">! 卡住／延後</button>}
                            <button type="button" onClick={() => openStepEditor(deal, dailyStep.id)} className={`btn-outline min-h-12 text-sm ${['doing', 'blocked'].includes(dailyStep.status) ? 'col-span-2' : ''}`}>修改詳細資料</button>
                          </div>
                        </section>

                        {otherBlockedSteps.length > 0 && (
                          <section className="rounded-xl border border-danger/45 bg-danger/5 p-3">
                            <p className="text-xs font-bold text-danger">卡住，需要處理</p>
                            <div className="mt-2 space-y-2">{otherBlockedSteps.map((step) => <button type="button" key={step.id} onClick={() => requestBlockedDetailsEdit(deal, step.id)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg bg-s1/80 px-3 py-2 text-left text-sm font-semibold text-ink"><span className="min-w-0"><span className="block truncate">{step.label}</span><span className="mt-0.5 block truncate text-[11px] font-normal text-ink-3">{step.blockedReason || '尚未填寫卡住原因'}{step.blockedFollowUpDate ? `・${dayjs(step.blockedFollowUpDate).format('MM/DD')} 再追` : ''}</span></span><span className="shrink-0 text-xs text-danger">修改 ›</span></button>)}</div>
                          </section>
                        )}

                        {parallelSteps.length > 0 && (
                          <section className="rounded-xl border border-teal/30 bg-teal/5 p-3">
                            <p className="text-xs font-bold text-teal">切換到其他可做階段</p>
                            <div className="mt-2 space-y-2">{parallelSteps.slice(0, 4).map((step) => <button type="button" key={step.id} onClick={() => setActiveStepByDeal((current) => ({ ...current, [deal.id]: step.id }))} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg bg-s1 px-3 text-left"><span className="truncate text-xs font-semibold text-ink-2">{step.label}</span><span className="shrink-0 text-[11px] font-bold text-teal">切換 ›</span></button>)}</div>
                          </section>
                        )}

                        <section className="rounded-xl border border-bdr bg-s2/45 p-3">
                          <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold text-ink-2">接下來</p><p className="text-[10px] text-ink-3">預計完成 {stats.targetDate ? dayjs(stats.targetDate).format('MM/DD') : '尚未設定'}</p></div>
                          {nextSteps.length ? <div className="mt-2 space-y-2">{nextSteps.map((step, index) => <div key={step.id} className="flex items-center gap-3 rounded-lg bg-s1/75 px-3 py-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-s3 text-[11px] font-bold text-ink-2">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{step.label}</p><p className="text-[10px] text-ink-3">{getWaitingOn(step, workflow) ? `等待：${getWaitingOn(step, workflow).label}` : '前置完成後可立即處理'}</p></div></div>)}</div> : <p className="mt-2 text-sm text-ink-3">完成目前階段後即可準備交車。</p>}
                        </section>
                        <button type="button" onClick={() => { setWorkspaceModeByDeal((current) => ({ ...current, [deal.id]: 'plan' })); setViewModeByDeal((current) => ({ ...current, [deal.id]: 'timeline' })); }} className="btn-outline min-h-12 w-full text-sm">查看完整排程圖</button>
                      </>
                    ) : (
                      <div className="rounded-2xl border border-ok/40 bg-ok/10 p-5 text-center">
                        <p className="text-3xl">✓</p><p className="mt-2 text-lg font-bold text-ok">所有施工階段都已完成</p>
                        {deal.commissionRecognizedAt
                          ? <p className="mt-2 rounded-xl bg-s1/75 px-3 py-2 text-sm font-bold text-ok">已於 {dayjs(deal.commissionRecognizedAt).format('YYYY/MM/DD')} 正式交車並認列薪資</p>
                          : <><p className="mt-1 text-xs text-ink-3">下一步只剩正式交車確認；施工完成不會自動計入薪資。</p><button type="button" disabled={!deal.clientId} onClick={() => deal.clientId ? onOpenClient?.(deal.clientId, { type: 'delivery', dealId: deal.id }) : setSaveErrors((current) => ({ ...current, [deal.id]: '這筆成交尚未連結客戶，請先回案件補上客戶資料。' }))} className="btn-primary mt-4 min-h-12 w-full disabled:opacity-45">確認正式交車與薪資月份</button></>}
                      </div>
                    )}
                  </div>
                )}

                {workspaceMode === 'plan' && <>
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
                  <button type="button" onClick={() => saveWorkflow(deal, mergeSuggestedWorkflow(latestWorkflow(deal), generateDeliveryWorkflow({ deal, pricing })))} className="btn-primary min-h-10 text-xs">
                    {workflow.length ? '＋ 補上建議步驟' : '依成交內容建立流程'}
                  </button>
                  <button type="button" onClick={() => onOpenPricing(deal)} className="btn-outline min-h-10 text-xs">成本與成交配備</button>
                  <button type="button" onClick={() => addStepDealId === deal.id ? setAddStepDealId(null) : openAddStep(deal, workflow)} className="min-h-11 rounded-xl border border-copper/50 bg-copper/12 px-4 text-sm font-bold text-copper">＋ 新增施工階段／狀態</button>
                  {workflow.length > 0 && <button type="button" onClick={() => toggleSortMode(deal, workflow, !isSortMode)} className={`min-h-10 rounded-lg border px-3 text-xs font-bold ${isSortMode ? 'border-gold bg-gold/12 text-gold' : 'border-bdr text-ink-2'}`}>{isSortMode ? '完成排序' : '拖拉排序'}</button>}
                </div>
                {isSortMode && (
                  <div className="flex items-start gap-3 rounded-xl border border-gold/45 bg-gold/8 p-3" role="status">
                    <span className="text-xl leading-none text-gold">☷</span>
                    <div><p className="text-xs font-bold text-ink">按住整張階段卡，上下拖到想要的位置</p><p className="mt-1 text-[11px] leading-5 text-ink-3">手機可直接長按移動；也可使用每張卡片下方的上移／下移。</p></div>
                  </div>
                )}
                {isSortMode && dragState?.dealId === deal.id && <div className="sticky top-2 z-20 rounded-xl border border-accent/55 bg-s1/95 px-3 py-2 text-center text-xs font-bold text-accent shadow-panel" role="status">正在移動「{displayWorkflow.find((candidate) => candidate.id === dragState.stepId)?.label}」— 移到目標位置後放開</div>}
                {workflow.length > 0 && (
                  <div className="grid grid-cols-2 rounded-xl border border-bdr bg-s2 p-1" role="tablist" aria-label="施工流程顯示方式">
                    <button type="button" onClick={() => setViewModeByDeal((current) => ({ ...current, [deal.id]: 'steps' }))} className={`min-h-10 rounded-lg text-xs font-bold ${viewMode === 'steps' ? 'bg-s1 text-accent shadow-sm' : 'text-ink-3'}`}>直式步驟</button>
                    <button type="button" onClick={() => setViewModeByDeal((current) => ({ ...current, [deal.id]: 'timeline' }))} className={`min-h-10 rounded-lg text-xs font-bold ${viewMode === 'timeline' ? 'bg-s1 text-accent shadow-sm' : 'text-ink-3'}`}>排程圖</button>
                  </div>
                )}
                {workflow.length === 0 && <p className="rounded-lg bg-s2 p-3 text-xs text-ink-3">系統可從成交配備辨識尾門、帆布、烤漆、H 架或箱體；建立後仍可逐項調整。</p>}
                {viewMode === 'steps' && visibleWorkflow.map((step) => {
                  const index = displayWorkflow.findIndex((candidate) => candidate.id === step.id);
                  const waiting = getWaitingOn(step, workflow);
                  const matchedSuppliers = suppliers.filter((supplier) => supplier.active !== false
                    && (!(supplier.services || []).length || (supplier.services || []).some((service) => step.service.includes(service) || service.includes(step.service))));
                  const supplierOptions = matchedSuppliers.length ? matchedSuppliers : suppliers.filter((supplier) => supplier.active !== false);
                  const stepKey = `${deal.id}:${step.id}`;
                  const stepDraft = stepDrafts[stepKey] || {};
                  const expanded = isSortMode ? false : (expandedSteps[stepKey] ?? stats.current?.id === step.id);
                  const finished = FINISHED_STATUSES.has(step.status);
                  const inCycle = cycleIds.has(step.id);
                  const supplierName = supplierNames.get(step.supplierId) || '未指派廠商';
                  const timing = getStageTiming(step, workflow);
                  return (
                    <article key={step.id} data-sort-step-id={step.id} data-sort-deal-id={deal.id} tabIndex={isSortMode ? 0 : undefined} aria-label={isSortMode ? `拖拉排序 ${step.label}` : undefined} onPointerDown={isSortMode ? (event) => startDragging(event, deal, displayWorkflow, step.id) : undefined} onPointerMove={isSortMode ? (event) => dragStep(event, deal) : undefined} onPointerUp={isSortMode ? (event) => finishDragging(event, deal) : undefined} onPointerCancel={isSortMode ? () => cancelDragging(deal, workflow) : undefined} onKeyDown={isSortMode ? (event) => { if (event.key === 'ArrowUp') { event.preventDefault(); moveStepByKeyboard(deal, displayWorkflow, step.id, -1); } if (event.key === 'ArrowDown') { event.preventDefault(); moveStepByKeyboard(deal, displayWorkflow, step.id, 1); } } : undefined} className={`overflow-hidden rounded-xl border transition ${isSortMode ? 'touch-none select-none cursor-grab active:cursor-grabbing' : ''} ${inCycle ? 'border-danger/65 bg-danger/5' : waiting ? 'border-gold/45 bg-gold/5' : stats.current?.id === step.id ? 'border-accent/45 bg-accent/5' : 'border-bdr bg-s2/35'} ${dragState?.stepId === step.id ? 'scale-[.99] opacity-55 shadow-panel' : ''} ${dragState?.overId === step.id && dragState?.stepId !== step.id ? 'ring-2 ring-gold/70' : ''}`}>
                      <div className="flex items-start gap-2.5 p-3">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${finished ? 'bg-ok text-on-accent' : waiting ? 'bg-gold/15 text-gold' : 'bg-accent/12 text-accent'}`}>{finished ? '✓' : index + 1}</span>
                          <button type="button" disabled={isSortMode} onClick={() => toggleStep(deal.id, step.id, stats.current?.id === step.id)} aria-expanded={expanded} className={`min-w-0 flex-1 text-left disabled:cursor-default ${isSortMode ? 'pointer-events-none' : ''}`}><p className="text-sm font-bold text-ink">{step.label}</p><div className="mt-1 flex flex-wrap gap-1.5 text-[10px]"><span className={`rounded-full px-2 py-0.5 font-bold ${STATUS_STYLES[step.status]}`}>{STATUS_LABELS.get(step.status)}</span><span className="rounded-full bg-s3 px-2 py-0.5 text-ink-3">{supplierName}</span><span className={`rounded-full px-2 py-0.5 ${timing.urgency === 'overdue' ? 'bg-danger/12 font-bold text-danger' : 'bg-s3 text-ink-3'}`}>{timing.elapsedDays ? `${timing.elapsedDays}/${timing.plannedDays} 天` : `分配 ${timing.plannedDays} 天`}</span>{step.cost !== '' && <span className="rounded-full bg-s3 px-2 py-0.5 text-ink-3">NT$ {Number(step.cost).toLocaleString('zh-TW')}</span>}</div>{waiting && <p className="mt-1 text-[10px] text-gold">等待「{waiting.label}」完成</p>}{inCycle && <p className="mt-1 text-[10px] font-bold text-danger">此步驟位於循環依賴中，請修正前置工作</p>}</button>
                          {isSortMode ? <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gold/55 bg-gold/12 text-xl text-gold">☷</span> : <><button type="button" onClick={() => { setExpandedSteps((current) => ({ ...current, [stepKey]: true })); setStepNameDrafts((current) => ({ ...current, [stepKey]: step.label })); }} className="min-h-11 shrink-0 rounded-lg border border-copper/35 px-2 text-[11px] font-bold text-copper" aria-label={`修改${step.label}名稱`}>✎ 改名</button><button type="button" onClick={() => toggleStep(deal.id, step.id, stats.current?.id === step.id)} aria-label={expanded ? `收合${step.label}` : `展開${step.label}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xs text-ink-3">{expanded ? '▲' : '▼'}</button></>}
                      </div>
                      {isSortMode && (
                        <div className="flex items-center justify-end gap-2 border-t border-bdr/60 px-3 py-2">
                          <button type="button" disabled={index === 0} onPointerDown={(event) => event.stopPropagation()} onClick={() => moveStepByKeyboard(deal, displayWorkflow, step.id, -1)} className="min-h-11 min-w-[76px] rounded-xl border border-bdr px-3 text-xs font-bold text-ink-2 disabled:opacity-35" aria-label={`上移${step.label}`}>↑ 上移</button>
                          <button type="button" disabled={index === displayWorkflow.length - 1} onPointerDown={(event) => event.stopPropagation()} onClick={() => moveStepByKeyboard(deal, displayWorkflow, step.id, 1)} className="min-h-11 min-w-[76px] rounded-xl border border-bdr px-3 text-xs font-bold text-ink-2 disabled:opacity-35" aria-label={`下移${step.label}`}>↓ 下移</button>
                        </div>
                      )}
                      {expanded && (
                        <div className="border-t border-bdr/60 p-3 space-y-3">
                          <div className="rounded-xl border border-copper/35 bg-copper/5 p-3">
                            <label className="block text-[11px] font-bold text-copper">施工階段名稱</label>
                            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><input value={stepNameDrafts[stepKey] ?? step.label} onChange={(event) => setStepNameDrafts((current) => ({ ...current, [stepKey]: event.target.value }))} className="min-h-11 w-full text-sm font-semibold" aria-label={`${step.label}施工階段名稱`} /><button type="button" disabled={!String(stepNameDrafts[stepKey] ?? step.label).trim() || String(stepNameDrafts[stepKey] ?? step.label).trim() === step.label} onClick={() => saveStepName(deal, step)} className="btn-primary min-h-11 px-3 text-xs disabled:opacity-40">儲存名稱</button></div>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] gap-2">
                            <select value={step.status} onChange={(event) => requestStatusChange(deal, step.id, event.target.value)} aria-label={`${step.label}狀態`} className="min-h-11 text-xs">
                              {DELIVERY_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                            {!finished && <button type="button" onClick={() => completeStep(deal, step.id)} className="btn-outline min-h-11 px-3 text-xs text-ok">✓ 完成</button>}
                          </div>
                          {step.status === 'blocked' && <button type="button" onClick={() => requestBlockedDetailsEdit(deal, step.id)} className="min-h-11 w-full rounded-xl border border-danger/40 bg-danger/5 px-3 text-xs font-bold text-danger">✎ 修改卡住原因與追蹤日</button>}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <label className="text-[10px] text-ink-3">施工廠商<select value={step.supplierId || ''} onChange={(event) => updateStep(deal, step.id, { supplierId: event.target.value })} aria-label={`${step.label}廠商`} className="mt-1 min-h-11 w-full text-xs"><option value="">未指派廠商</option>{supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
                            <label className="text-[10px] text-ink-3">預計日期<input type="date" value={step.plannedDate || ''} onChange={(event) => updateStep(deal, step.id, { plannedDate: event.target.value })} className="mt-1 min-h-11 w-full text-xs" /></label>
                            <label className="text-[10px] text-ink-3">分配天數<input inputMode="numeric" value={Object.hasOwn(stepDraft, 'plannedDays') ? stepDraft.plannedDays : (step.plannedDays || 1)} onChange={(event) => setStepDraftValue(deal, step.id, 'plannedDays', event.target.value.replace(/[^0-9]/g, ''))} onBlur={() => flushStepDraft(deal, step.id)} className="mt-1 min-h-11 w-full text-xs" /></label>
                            <label className="text-[10px] text-ink-3">成本／廠商報價<input inputMode="numeric" value={Object.hasOwn(stepDraft, 'cost') ? stepDraft.cost : (step.cost ?? '')} onChange={(event) => setStepDraftValue(deal, step.id, 'cost', event.target.value.replace(/[^0-9]/g, ''))} onBlur={() => flushStepDraft(deal, step.id)} placeholder="尚未確認" className="mt-1 min-h-11 w-full text-xs" /></label>
                            <label className="text-[10px] text-ink-3">前置工作<select value={step.dependsOn || ''} onChange={(event) => requestDependencyChange(deal, step.id, event.target.value || null)} className="mt-1 min-h-11 w-full text-xs"><option value="">可獨立／可同時進行</option>{displayWorkflow.filter((candidate) => candidate.id !== step.id && !wouldCreateCycle(displayWorkflow, step.id, candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label>
                          </div>
                          <textarea value={Object.hasOwn(stepDraft, 'note') ? stepDraft.note : (step.note || '')} onChange={(event) => setStepDraftValue(deal, step.id, 'note', event.target.value)} onBlur={() => flushStepDraft(deal, step.id)} rows={2} placeholder="聯繫結果、施工地址、注意事項或進度備註" className="w-full text-xs" />
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button type="button" onClick={() => requestDeleteStep(deal, step.id)} className="min-h-11 px-3 text-xs text-danger/80">刪除工作</button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
                {viewMode === 'steps' && !isSortMode && completedSteps.length > 0 && (
                  <button type="button" onClick={() => setShowCompletedByDeal((current) => ({ ...current, [deal.id]: !showCompleted }))} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-bdr bg-s2/50 px-3 text-sm font-bold text-ink-2">
                    <span>✓ 已完成 {completedSteps.length} 項</span><span className="text-xs text-ink-3">{showCompleted ? '收合 ▲' : '展開 ▼'}</span>
                  </button>
                )}
                {viewMode === 'timeline' && workflow.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1 text-[10px] text-ink-3"><span>流程起點</span><span>第 {stats.schedule.totalDays} 天完成</span></div>
                    {stats.schedule.rows.map((row, index) => {
                      const timing = getStageTiming(row, workflow);
                      const waiting = getWaitingOn(row, workflow);
                      const left = stats.schedule.totalDays ? row.startOffset / stats.schedule.totalDays * 100 : 0;
                      const width = stats.schedule.totalDays ? row.plannedDays / stats.schedule.totalDays * 100 : 100;
                      const stepKey = `${deal.id}:${row.id}`;
                      const editing = timelineEditKey === stepKey;
                      const stepDraft = stepDrafts[stepKey] || {};
                      const finished = FINISHED_STATUSES.has(row.status);
                      const matchedSuppliers = suppliers.filter((supplier) => supplier.active !== false
                        && (!(supplier.services || []).length || (supplier.services || []).some((service) => row.service.includes(service) || service.includes(row.service))));
                      const supplierOptions = matchedSuppliers.length ? matchedSuppliers : suppliers.filter((supplier) => supplier.active !== false);
                      return <article key={row.id} className={`overflow-hidden rounded-xl border ${stats.current?.id === row.id ? 'border-accent/50 bg-accent/5' : 'border-bdr bg-s2/35'}`}>
                        <div className="p-3">
                          <div className="flex items-start gap-2"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${finished ? 'bg-ok text-on-accent' : 'bg-s3 text-ink-2'}`}>{finished ? '✓' : index + 1}</span><div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink">{row.label}</p><p className={`mt-0.5 text-[11px] ${timing.urgency === 'overdue' ? 'font-bold text-danger' : 'text-ink-3'}`}>{waiting ? `等待：${waiting.label}` : timing.elapsedDays ? `實際 ${timing.elapsedDays} 天／分配 ${timing.plannedDays} 天${timing.overDays ? `・超過 ${timing.overDays} 天` : ''}` : `分配 ${timing.plannedDays} 天`}</p></div><button type="button" onClick={() => { setTimelineEditKey(editing ? null : stepKey); if (!editing) setStepNameDrafts((current) => ({ ...current, [stepKey]: row.label })); }} className={`min-h-11 shrink-0 rounded-xl border px-3 text-xs font-bold ${editing ? 'border-accent bg-accent/12 text-accent' : 'border-copper/40 text-copper'}`}>{editing ? '收合 ▲' : '✎ 修改'}</button></div>
                          <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-s3"><div className={`absolute top-0 h-full rounded-full ${timing.urgency === 'overdue' ? 'bg-danger' : finished ? 'bg-ok' : 'bg-accent'}`} style={{ left: `${left}%`, width: `${Math.max(width, 3)}%` }} /></div>
                          <div className="mt-1 flex justify-between text-[9px] text-ink-3"><span>第 {row.startOffset + 1} 天</span><span>第 {row.endOffset} 天</span></div>
                        </div>
                        {editing && <div className="space-y-3 border-t border-bdr/70 bg-s1/45 p-3">
                          <div className="rounded-xl border border-copper/35 bg-copper/5 p-3"><label className="block text-[11px] font-bold text-copper">施工階段名稱</label><div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><input value={stepNameDrafts[stepKey] ?? row.label} onChange={(event) => setStepNameDrafts((current) => ({ ...current, [stepKey]: event.target.value }))} className="min-h-11 w-full text-sm font-semibold" /><button type="button" disabled={!String(stepNameDrafts[stepKey] ?? row.label).trim() || String(stepNameDrafts[stepKey] ?? row.label).trim() === row.label} onClick={() => saveStepName(deal, row)} className="btn-primary min-h-11 px-3 text-xs disabled:opacity-40">儲存名稱</button></div></div>
                          <div className="grid grid-cols-[1fr_auto] gap-2"><select value={row.status} onChange={(event) => requestStatusChange(deal, row.id, event.target.value)} aria-label={`${row.label}狀態`} className="min-h-11 text-xs">{DELIVERY_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{!finished && <button type="button" onClick={() => completeStep(deal, row.id)} className="btn-outline min-h-11 px-3 text-xs text-ok">✓ 完成</button>}</div>
                          {row.status === 'blocked' && <button type="button" onClick={() => requestBlockedDetailsEdit(deal, row.id)} className="min-h-11 w-full rounded-xl border border-danger/40 bg-danger/5 px-3 text-xs font-bold text-danger">✎ 修改卡住原因與追蹤日</button>}
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <label className="text-[10px] text-ink-3">施工廠商<select value={row.supplierId || ''} onChange={(event) => updateStep(deal, row.id, { supplierId: event.target.value })} className="mt-1 min-h-11 w-full text-xs"><option value="">未指派廠商</option>{supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
                            <label className="text-[10px] text-ink-3">預計日期<input type="date" value={row.plannedDate || ''} onChange={(event) => updateStep(deal, row.id, { plannedDate: event.target.value })} className="mt-1 min-h-11 w-full text-xs" /></label>
                            <label className="text-[10px] text-ink-3">分配天數<input inputMode="numeric" value={Object.hasOwn(stepDraft, 'plannedDays') ? stepDraft.plannedDays : (row.plannedDays || 1)} onChange={(event) => setStepDraftValue(deal, row.id, 'plannedDays', event.target.value.replace(/[^0-9]/g, ''))} onBlur={() => flushStepDraft(deal, row.id)} className="mt-1 min-h-11 w-full text-xs" /></label>
                            <label className="text-[10px] text-ink-3">成本／廠商報價<input inputMode="numeric" value={Object.hasOwn(stepDraft, 'cost') ? stepDraft.cost : (row.cost ?? '')} onChange={(event) => setStepDraftValue(deal, row.id, 'cost', event.target.value.replace(/[^0-9]/g, ''))} onBlur={() => flushStepDraft(deal, row.id)} placeholder="尚未確認" className="mt-1 min-h-11 w-full text-xs" /></label>
                            <label className="text-[10px] text-ink-3 sm:col-span-2">前置工作<select value={row.dependsOn || ''} onChange={(event) => requestDependencyChange(deal, row.id, event.target.value || null)} className="mt-1 min-h-11 w-full text-xs"><option value="">可獨立／可同時進行</option>{workflow.filter((candidate) => candidate.id !== row.id && !wouldCreateCycle(workflow, row.id, candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label>
                          </div>
                          <textarea value={Object.hasOwn(stepDraft, 'note') ? stepDraft.note : (row.note || '')} onChange={(event) => setStepDraftValue(deal, row.id, 'note', event.target.value)} onBlur={() => flushStepDraft(deal, row.id)} rows={2} placeholder="聯繫結果、施工地址、注意事項或進度備註" className="w-full text-xs" />
                          <div className="flex justify-end"><button type="button" onClick={() => requestDeleteStep(deal, row.id)} className="min-h-11 px-3 text-xs text-danger/80">刪除工作</button></div>
                        </div>}
                      </article>;
                    })}
                  </div>
                )}
                {workflowEvents.length > 0 && !isSortMode && (
                  <div className="overflow-hidden rounded-xl border border-bdr bg-s2/35">
                    <button type="button" onClick={() => setShowHistoryByDeal((current) => ({ ...current, [deal.id]: !current[deal.id] }))} className="flex min-h-11 w-full items-center justify-between px-3 text-sm font-bold text-ink-2" aria-expanded={showHistoryByDeal[deal.id] === true}>
                      <span>進度紀錄・{workflowEvents.length} 筆</span><span className="text-xs text-ink-3">{showHistoryByDeal[deal.id] ? '收合 ▲' : '查看 ▼'}</span>
                    </button>
                    {showHistoryByDeal[deal.id] && (
                      <div className="border-t border-bdr/60 px-3">
                        {workflowEvents.slice(0, 10).map((event) => (
                          <article key={event.id} className="flex items-start gap-3 border-b border-bdr/50 py-3 last:border-0">
                            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${event.revertedAt ? 'bg-s3 text-ink-3' : event.type === 'restore' ? 'bg-gold/15 text-gold' : 'bg-accent/15 text-accent'}`}>{event.type === 'restore' ? '↶' : event.revertedAt ? '—' : '✓'}</span>
                            <div className="min-w-0 flex-1"><p className={`text-sm font-semibold ${event.revertedAt ? 'text-ink-3 line-through' : 'text-ink'}`}>{event.action}</p><p className="mt-0.5 text-[11px] text-ink-3">{dayjs(event.createdAt).format('MM/DD HH:mm')}{event.detail ? `・${event.detail}` : ''}{event.revertedAt ? '・已復原' : ''}</p></div>
                            {event.type !== 'restore' && !event.revertedAt && (event.restorePoint || event.beforeWorkflow?.length > 0) && <button type="button" onClick={() => requestRestoreEvent(deal, event)} className="min-h-11 shrink-0 rounded-lg border border-bdr px-3 text-xs font-bold text-ink-2">恢復</button>}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {addStepDealId === deal.id && (
                  <div className="rounded-xl border-2 border-copper/45 bg-copper/5 p-3">
                    <div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-bold text-ink">新增施工階段</p><p className="mt-0.5 text-[11px] text-ink-3">名稱、工期與前置階段都由你決定。</p></div><button type="button" onClick={() => setAddStepDealId(null)} className="btn-ghost min-h-11 px-3 text-xs">取消</button></div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-[11px] font-medium text-ink-3 sm:col-span-2">施工階段名稱<input value={newStep.label} onChange={(event) => setNewStep((current) => ({ ...current, label: event.target.value }))} placeholder="例如：安裝冷凍機" className="mt-1 min-h-12 w-full text-sm" /></label><label className="text-[11px] font-medium text-ink-3">工作類型<input value={newStep.service} onChange={(event) => setNewStep((current) => ({ ...current, service: event.target.value }))} placeholder="例如：冷凍設備" className="mt-1 min-h-12 w-full text-sm" /></label><label className="text-[11px] font-medium text-ink-3">預計天數<input inputMode="numeric" value={newStep.plannedDays} onChange={(event) => setNewStep((current) => ({ ...current, plannedDays: event.target.value.replace(/[^0-9]/g, '') }))} className="mt-1 min-h-12 w-full text-sm" /></label><label className="text-[11px] font-medium text-ink-3 sm:col-span-2">接在哪個階段之後<select value={newStep.dependsOn} onChange={(event) => setNewStep((current) => ({ ...current, dependsOn: event.target.value }))} className="mt-1 min-h-12 w-full text-sm"><option value="">可獨立／可同時進行</option>{displayWorkflow.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label><button type="button" disabled={!newStep.label.trim()} onClick={() => addStep(deal, workflow)} className="btn-primary min-h-12 sm:col-span-2 disabled:opacity-40">確認加入施工流程</button></div>
                  </div>
                )}
                </>}
              </div>
            )}
          </section>
        );
      })}
      <ConfirmActionDialog action={confirmAction} busy={confirmBusy} onCancel={() => setConfirmAction(null)} onConfirm={performConfirmedAction} onActionChange={(patch) => setConfirmAction((current) => current ? { ...current, ...patch, error: null } : current)} />
      <UndoToast action={undoAction} busy={undoBusy} onUndo={performUndo} onDismiss={() => setUndoAction(null)} />
    </div>
  );
}

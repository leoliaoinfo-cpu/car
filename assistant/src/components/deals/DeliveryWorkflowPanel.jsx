import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  activateAvailableWorkflowSteps, buildDeliverySchedule, DELIVERY_STATUS_OPTIONS, generateDeliveryWorkflow,
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

function ConfirmActionDialog({ action, busy, onCancel, onConfirm }) {
  if (!action) return null;
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
        {action.error && <p role="alert" className="mt-3 rounded-xl border border-danger/45 bg-danger/10 p-3 text-sm font-semibold text-danger">{action.error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="btn-outline min-h-12 disabled:opacity-50">取消</button>
          <button type="button" disabled={busy} onClick={onConfirm} className={`${action.tone === 'danger' ? 'btn-danger' : 'btn-primary'} min-h-12 disabled:opacity-50`}>{busy ? '儲存中…' : action.confirmLabel || '確認'}</button>
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

export default function DeliveryWorkflowPanel({ deals, clients, pricingById, suppliers, onSaveDeal, onOpenPricing, focusDealId = null }) {
  const [openDealId, setOpenDealId] = useState(null);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [addStepDealId, setAddStepDealId] = useState(null);
  const [viewModeByDeal, setViewModeByDeal] = useState({});
  const [sortModeDealId, setSortModeDealId] = useState(null);
  const [sortDrafts, setSortDrafts] = useState({});
  const [dragState, setDragState] = useState(null);
  const [stepDrafts, setStepDrafts] = useState({});
  const [saveErrors, setSaveErrors] = useState({});
  const [saveStatusByDeal, setSaveStatusByDeal] = useState({});
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [undoAction, setUndoAction] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [showCompletedByDeal, setShowCompletedByDeal] = useState({});
  const [showHistoryByDeal, setShowHistoryByDeal] = useState({});
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
  const [newStep, setNewStep] = useState({ label: '', service: '' });
  const clientNames = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const supplierNames = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])), [suppliers]);
  const sortedDeals = [...deals].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

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
    const current = progressStats(workflow, deal).current;
    setOpenDealId(focusDealId);
    if (current) setExpandedSteps((previous) => ({ ...previous, [`${deal.id}:${current.id}`]: true }));
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
    setConfirmAction({
      title: `確認將「${step.label}」改為${nextLabel}？`,
      description: preview.newlyAvailable.length > 1 ? `此操作會同時啟動 ${preview.newlyAvailable.length} 個可並行工作。` : '確認後會更新案件進度。',
      effects,
      confirmLabel: nextStatus === 'done' ? '確認完成' : `確認${nextLabel}`,
      tone: nextStatus === 'na' || nextStatus === 'blocked' ? 'danger' : 'default',
      icon: nextStatus === 'done' ? '✓' : nextStatus === 'blocked' ? '!' : '→',
      perform: async () => {
        const currentWorkflow = latestWorkflow(deal);
        const currentStep = currentWorkflow.find((candidate) => candidate.id === stepId);
        if (!currentStep || currentStep.status === nextStatus) return true;
        const plan = planWorkflowStatusChange(currentWorkflow, stepId, nextStatus);
        const event = workflowEvent({
          type: 'status', action: `將「${currentStep.label}」改為${nextLabel}`,
          step: currentStep, beforeWorkflow: plan.beforeWorkflow, afterWorkflow: plan.nextWorkflow,
          fromStatus: currentStep.status, toStatus: nextStatus,
          detail: plan.newlyAvailable.length ? `啟動：${plan.newlyAvailable.map((candidate) => candidate.label).join('、')}` : '',
        });
        const saved = await saveWorkflow(deal, plan.nextWorkflow, { event });
        if (!saved) return false;
        setUndoAction({ dealId: deal.id, eventId: event.id, message: event.action });
        if (FINISHED_STATUSES.has(nextStatus)) {
          setExpandedSteps((current) => ({ ...current, [`${deal.id}:${stepId}`]: false }));
        }
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
      effects: ['重新判定這個階段是否需要等待', '重新計算預計施工起點與總工期', '不會刪除任何既有進度或備註'],
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
        const event = workflowEvent({
          type: 'dependency', action: `修改「${currentStep.label}」的前置工作`,
          step: currentStep, beforeWorkflow: currentWorkflow, afterWorkflow: changed,
          detail: `${previous?.label || '可獨立進行'} → ${next?.label || '可獨立進行'}`,
        });
        const saved = await saveWorkflow(deal, changed, { event });
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
    setConfirmAction((current) => current ? { ...current, error: null } : current);
    setConfirmBusy(true);
    try {
      const completed = await action.perform();
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
    const previous = currentWorkflow.at(-1);
    const added = {
      id: makeId(), label: newStep.label.trim(), service: newStep.service.trim() || '其他',
      dependsOn: previous?.id || null, status: 'todo', supplierId: '', plannedDate: '', cost: '', note: '',
      plannedDays: 1, activatedAt: null, completedAt: null, statusChangedAt: null,
    };
    saveWorkflow(deal, [...currentWorkflow, added]);
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
        const workflow = latestWorkflow(deal);
        const stats = progressStats(workflow, deal);
        const pricing = pricingById.get(`deal:${deal.id}`);
        const isOpen = openDealId === deal.id;
        const currentWaiting = stats.current ? getWaitingOn(stats.current, workflow) : null;
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
                <span className="block text-[11px] text-ink-3">{deal.date ? dayjs(deal.date).format('YYYY/MM/DD') : '日期未填'}・{workflow.length ? `完成 ${stats.complete}/${workflow.length}` : '尚未建立流程'}{saveStatus === 'saving' ? '・儲存中…' : saveStatus === 'saved' ? '・已儲存' : saveStatus === 'error' ? '・儲存失敗' : ''}</span>
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
                  <button type="button" onClick={() => setAddStepDealId(addStepDealId === deal.id ? null : deal.id)} className="btn-outline min-h-10 text-xs">＋ 新增工作</button>
                  {workflow.length > 0 && <button type="button" onClick={() => toggleSortMode(deal, workflow, !isSortMode)} className={`min-h-10 rounded-lg border px-3 text-xs font-bold ${isSortMode ? 'border-gold bg-gold/12 text-gold' : 'border-bdr text-ink-2'}`}>{isSortMode ? '完成排序' : '拖拉排序'}</button>}
                </div>
                {isSortMode && (
                  <div className="flex items-start gap-3 rounded-xl border border-gold/45 bg-gold/8 p-3" role="status">
                    <span className="text-xl leading-none text-gold">☷</span>
                    <div><p className="text-xs font-bold text-ink">按住右側把手，上下拖到想要的位置</p><p className="mt-1 text-[11px] leading-5 text-ink-3">拖拉只調整顯示順序；實際施工先後仍依「前置工作」計算。</p></div>
                  </div>
                )}
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
                    <article key={step.id} data-sort-step-id={step.id} data-sort-deal-id={deal.id} className={`overflow-hidden rounded-xl border transition ${inCycle ? 'border-danger/65 bg-danger/5' : waiting ? 'border-gold/45 bg-gold/5' : stats.current?.id === step.id ? 'border-accent/45 bg-accent/5' : 'border-bdr bg-s2/35'} ${dragState?.stepId === step.id ? 'scale-[.99] opacity-55' : ''} ${dragState?.overId === step.id && dragState?.stepId !== step.id ? 'ring-2 ring-gold/60' : ''}`}>
                      <div className="flex items-start gap-2.5 p-3">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${finished ? 'bg-ok text-on-accent' : waiting ? 'bg-gold/15 text-gold' : 'bg-accent/12 text-accent'}`}>{finished ? '✓' : index + 1}</span>
                          <button type="button" disabled={isSortMode} onClick={() => toggleStep(deal.id, step.id, stats.current?.id === step.id)} aria-expanded={expanded} className="min-w-0 flex-1 text-left disabled:cursor-default"><p className="text-sm font-bold text-ink">{step.label}</p><div className="mt-1 flex flex-wrap gap-1.5 text-[10px]"><span className={`rounded-full px-2 py-0.5 font-bold ${STATUS_STYLES[step.status]}`}>{STATUS_LABELS.get(step.status)}</span><span className="rounded-full bg-s3 px-2 py-0.5 text-ink-3">{supplierName}</span><span className={`rounded-full px-2 py-0.5 ${timing.urgency === 'overdue' ? 'bg-danger/12 font-bold text-danger' : 'bg-s3 text-ink-3'}`}>{timing.elapsedDays ? `${timing.elapsedDays}/${timing.plannedDays} 天` : `分配 ${timing.plannedDays} 天`}</span>{step.cost !== '' && <span className="rounded-full bg-s3 px-2 py-0.5 text-ink-3">NT$ {Number(step.cost).toLocaleString('zh-TW')}</span>}</div>{waiting && <p className="mt-1 text-[10px] text-gold">等待「{waiting.label}」完成</p>}{inCycle && <p className="mt-1 text-[10px] font-bold text-danger">此步驟位於循環依賴中，請修正前置工作</p>}</button>
                          {isSortMode ? <button type="button" aria-label={`拖拉調整${step.label}`} title="按住拖拉；方向鍵也可微調" className="flex h-11 w-11 touch-none select-none shrink-0 items-center justify-center rounded-xl border border-gold/45 bg-gold/10 text-xl text-gold active:scale-95" onPointerDown={(event) => startDragging(event, deal, displayWorkflow, step.id)} onPointerMove={(event) => dragStep(event, deal)} onPointerUp={(event) => finishDragging(event, deal)} onPointerCancel={() => cancelDragging(deal, workflow)} onKeyDown={(event) => { if (event.key === 'ArrowUp') { event.preventDefault(); moveStepByKeyboard(deal, displayWorkflow, step.id, -1); } if (event.key === 'ArrowDown') { event.preventDefault(); moveStepByKeyboard(deal, displayWorkflow, step.id, 1); } }}>☷</button> : <button type="button" onClick={() => toggleStep(deal.id, step.id, stats.current?.id === step.id)} aria-label={expanded ? `收合${step.label}` : `展開${step.label}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xs text-ink-3">{expanded ? '▲' : '▼'}</button>}
                      </div>
                      {isSortMode && (
                        <div className="flex items-center justify-end gap-2 border-t border-bdr/60 px-3 py-2">
                          <button type="button" disabled={index === 0} onClick={() => moveStepByKeyboard(deal, displayWorkflow, step.id, -1)} className="min-h-11 min-w-[76px] rounded-xl border border-bdr px-3 text-xs font-bold text-ink-2 disabled:opacity-35" aria-label={`上移${step.label}`}>↑ 上移</button>
                          <button type="button" disabled={index === displayWorkflow.length - 1} onClick={() => moveStepByKeyboard(deal, displayWorkflow, step.id, 1)} className="min-h-11 min-w-[76px] rounded-xl border border-bdr px-3 text-xs font-bold text-ink-2 disabled:opacity-35" aria-label={`下移${step.label}`}>↓ 下移</button>
                        </div>
                      )}
                      {expanded && (
                        <div className="border-t border-bdr/60 p-3 space-y-3">
                          <div className="grid grid-cols-[1fr_auto] gap-2">
                            <select value={step.status} onChange={(event) => requestStatusChange(deal, step.id, event.target.value)} aria-label={`${step.label}狀態`} className="min-h-11 text-xs">
                              {DELIVERY_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                            {!finished && <button type="button" onClick={() => completeStep(deal, step.id)} className="btn-outline min-h-11 px-3 text-xs text-ok">✓ 完成</button>}
                          </div>
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
                      return <article key={row.id} className={`rounded-xl border p-3 ${stats.current?.id === row.id ? 'border-accent/50 bg-accent/5' : 'border-bdr bg-s2/35'}`}>
                        <div className="flex items-start gap-2"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${FINISHED_STATUSES.has(row.status) ? 'bg-ok text-on-accent' : 'bg-s3 text-ink-2'}`}>{FINISHED_STATUSES.has(row.status) ? '✓' : index + 1}</span><div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink">{row.label}</p><p className={`mt-0.5 text-[11px] ${timing.urgency === 'overdue' ? 'font-bold text-danger' : 'text-ink-3'}`}>{waiting ? `等待：${waiting.label}` : timing.elapsedDays ? `實際 ${timing.elapsedDays} 天／分配 ${timing.plannedDays} 天${timing.overDays ? `・超過 ${timing.overDays} 天` : ''}` : `分配 ${timing.plannedDays} 天`}</p></div></div>
                        <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-s3"><div className={`absolute top-0 h-full rounded-full ${timing.urgency === 'overdue' ? 'bg-danger' : FINISHED_STATUSES.has(row.status) ? 'bg-ok' : 'bg-accent'}`} style={{ left: `${left}%`, width: `${Math.max(width, 3)}%` }} /></div>
                        <div className="mt-1 flex justify-between text-[9px] text-ink-3"><span>第 {row.startOffset + 1} 天</span><span>第 {row.endOffset} 天</span></div>
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
      <ConfirmActionDialog action={confirmAction} busy={confirmBusy} onCancel={() => setConfirmAction(null)} onConfirm={performConfirmedAction} />
      <UndoToast action={undoAction} busy={undoBusy} onUndo={performUndo} onDismiss={() => setUndoAction(null)} />
    </div>
  );
}

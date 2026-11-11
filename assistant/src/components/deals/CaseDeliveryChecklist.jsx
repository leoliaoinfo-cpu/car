import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { today } from '../../utils/date';
import {
  ANNUAL_REMINDER_DEFS, createWorkflowRestorePoint, defaultAnnualReminders, generateDeliveryWorkflow,
  getCurrentWorkflowStep, isDeliveryFinalStep, normalizeDeliveryWorkflow, planDeliveryCompletion,
  restoreWorkflowChange, stockGuardItems, updateWorkflowStepStatus,
} from '../../utils/delivery';
import { DELIVERY_FOLLOWUP_DAYS } from '../../utils/crm';
import { STOCK_STATUSES } from '../../utils/stock';

const DONE = new Set(['done', 'na']);
const STATUS_LABEL = new Map(STOCK_STATUSES);
const UNDO_MS = 6000;

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function Sheet({ title, children, actions }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/55" />
      <section className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-bdr bg-s1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-panel sm:rounded-2xl">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {children}
        <div className="mt-5 grid grid-cols-2 gap-3">{actions}</div>
      </section>
    </div>
  );
}

/**
 * 案件內的施工進度清單（不需要密碼）：每一步點一下就生效，可立刻「復原」。
 * 只顯示進度、廠商、日期與備註，不顯示任何成本或利潤。
 * 最後一步是真正的「確認交車」：記錄交車、建立售後提醒、把案件改成已完成。
 */
export default function CaseDeliveryChecklist({ deal, caseItem, onGoStock }) {
  const { saveDeal, confirmDelivery, suppliers = [], clients = [] } = useApp();
  const [openStepId, setOpenStepId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  const [newLabel, setNewLabel] = useState('');
  const flowRef = useRef([]);
  const pendingRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  const toastTimer = useRef(null);

  if (pendingRef.current === 0) flowRef.current = normalizeDeliveryWorkflow(deal);
  const workflow = flowRef.current;
  const delivered = Boolean(deal.deliveredAt || (caseItem?.status === 'completed' && workflow.some((step) => isDeliveryFinalStep(step) && DONE.has(step.status))));
  const complete = workflow.filter((step) => DONE.has(step.status)).length;
  const percent = workflow.length ? Math.round(complete / workflow.length * 100) : 0;
  const currentStep = delivered ? null : getCurrentWorkflowStep(workflow);
  const supplierNames = useMemo(() => new Map(suppliers.map((row) => [row.id, row.name])), [suppliers]);
  const client = clients.find((row) => row.id === deal.clientId);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function showToast(next) {
    clearTimeout(toastTimer.current);
    setToast(next);
    if (next) toastTimer.current = setTimeout(() => setToast(null), UNDO_MS);
  }

  function persist(nextFlow) {
    flowRef.current = nextFlow;
    pendingRef.current += 1;
    bump((n) => n + 1);
    const stamp = new Date().toISOString();
    queueRef.current = queueRef.current.catch(() => {}).then(() => saveDeal({
      ...deal, deliveryWorkflow: nextFlow, deliveryWorkflowUpdatedAt: stamp,
      deliveryWorkflowStartDate: deal.deliveryWorkflowStartDate || today(),
    }));
    return queueRef.current
      .then(() => { setError(''); return true; })
      .catch((cause) => { flowRef.current = normalizeDeliveryWorkflow(deal); setError(cause?.message || '施工進度儲存失敗，請再試一次。'); return false; })
      .finally(() => { pendingRef.current -= 1; bump((n) => n + 1); });
  }

  async function setStatus(step, status) {
    const before = flowRef.current;
    const after = updateWorkflowStepStatus(before, step.id, status);
    const point = createWorkflowRestorePoint(before, after);
    if (!(await persist(after))) return;
    showToast({
      message: DONE.has(status) ? `已完成「${step.label}」` : `「${step.label}」改回未完成`,
      undo: async () => { showToast(null); await persist(restoreWorkflowChange(flowRef.current, point)); },
    });
  }

  function tick(step) {
    setToast(null);
    if (DONE.has(step.status)) { setStatus(step, 'todo'); return; }
    const missing = stockGuardItems(step, deal);
    if (missing.length) { setDialog({ type: 'stock', step, missing }); return; }
    setStatus(step, 'done');
  }

  function startDelivery(step) {
    setToast(null);
    const missing = stockGuardItems(step, deal);
    if (missing.length) { setDialog({ type: 'stock', step, missing }); return; }
    openDeliveryDialog();
  }

  function openDeliveryDialog() {
    const date = today();
    setDialog({
      type: 'deliver', date, annual: defaultAnnualReminders(date),
      skipped: planDeliveryCompletion(flowRef.current).skipped,
    });
  }

  async function submitDelivery() {
    if (busy || !dialog) return;
    setBusy(true);
    setError('');
    try {
      await confirmDelivery({ dealId: deal.id, date: dialog.date || today(), annual: dialog.annual });
      setDialog(null);
      showToast({ message: '已確認交車，案件已完成' });
    } catch (cause) {
      setError(cause?.message || '確認交車失敗，請再按一次。');
    } finally {
      setBusy(false);
    }
  }

  function createFlow() {
    persist(generateDeliveryWorkflow({ deal, pricing: { lines: deal.quoteSnapshot?.items || [] } }));
  }

  function patchStep(step, patch) {
    persist(flowRef.current.map((row) => row.id === step.id ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row));
  }

  function submitBlocked() {
    const { step, reason, owner, followUp } = dialog;
    if (!reason.trim() || !followUp) return;
    setDialog(null);
    const before = flowRef.current;
    const after = updateWorkflowStepStatus(before, step.id, 'blocked')
      .map((row) => row.id === step.id ? { ...row, blockedReason: reason.trim(), blockedOwner: owner.trim(), blockedFollowUpDate: followUp } : row);
    persist(after);
  }

  function resetFlow() {
    setDialog(null);
    persist(generateDeliveryWorkflow({ deal, pricing: { lines: deal.quoteSnapshot?.items || [] } }));
  }

  function addStep() {
    const label = newLabel.trim();
    if (!label) return;
    const last = flowRef.current.filter((row) => !isDeliveryFinalStep(row)).at(-1);
    const finalIndex = flowRef.current.findIndex(isDeliveryFinalStep);
    const added = {
      id: makeId(), label, service: '其他', dependsOn: last?.id || null, status: 'todo', supplierId: '', plannedDate: '',
      cost: '', note: '', plannedDays: 1, activatedAt: null, completedAt: null, statusChangedAt: null,
    };
    const next = [...flowRef.current];
    next.splice(finalIndex < 0 ? next.length : finalIndex, 0, added);
    setNewLabel('');
    persist(next);
  }

  if (!workflow.length) {
    return (
      <section id="case-sop" className="card p-4">
        <h2 className="font-bold text-ink">🚚 施工進度</h2>
        <p className="mt-1 text-xs text-ink-3">依成交的配件建立尾門、帆布、烤漆、洗車到交車的步驟，之後一步一步點完成。</p>
        <button type="button" onClick={createFlow} className="btn-primary mt-3 min-h-12 w-full">建立施工進度</button>
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </section>
    );
  }

  const steps = (
    <ol className="mt-3 space-y-2">
      {workflow.map((step, index) => {
        const finished = DONE.has(step.status);
        const isFinal = isDeliveryFinalStep(step);
        const isCurrent = currentStep?.id === step.id;
        const open = openStepId === step.id;
        const supplier = supplierNames.get(step.supplierId);
        return (
          <li key={step.id} className={`rounded-xl border p-2.5 ${step.status === 'blocked' ? 'border-danger/45 bg-danger/5' : isCurrent ? 'border-accent bg-accent/8' : finished ? 'border-ok/25 bg-ok/5' : 'border-bdr bg-s2/60'}`}>
            <div className="flex items-center gap-2.5">
              {isFinal && !finished && !delivered ? (
                <button type="button" onClick={() => startDelivery(step)} className="min-h-12 shrink-0 rounded-xl bg-ok px-3 text-sm font-bold text-on-accent">🚚 確認交車</button>
              ) : (
                <button type="button" role="checkbox" aria-checked={finished} aria-label={`${finished ? '取消完成' : '完成'}：${step.label}`}
                  disabled={isFinal && delivered} onClick={() => tick(step)}
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-xl font-bold ${finished ? 'border-ok bg-ok text-on-accent' : 'border-bdr bg-s1 text-transparent'}`}>
                  ✓
                </button>
              )}
              <button type="button" onClick={() => setOpenStepId(open ? null : step.id)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
                <span className={`block text-sm font-bold ${finished ? 'text-ink-3 line-through' : 'text-ink'}`}>{index + 1}. {step.label}{step.status === 'na' ? '（略過）' : ''}</span>
                <span className="mt-0.5 block text-[11px] text-ink-3">
                  {[isCurrent ? '現在做這步' : '', step.status === 'blocked' ? '卡住' : '', supplier || '', step.plannedDate ? `預計 ${dayjs(step.plannedDate).format('MM/DD')}` : ''].filter(Boolean).join('・') || (finished && step.completedAt ? `${dayjs(step.completedAt).format('MM/DD')} 完成` : '點開可填廠商、日期')}
                </span>
              </button>
            </div>
            {step.status === 'blocked' && (
              <div className="mt-2 rounded-lg bg-s1 p-2 text-xs">
                <p className="font-bold text-danger">{step.blockedReason || '目前卡住'}</p>
                <p className="mt-0.5 text-ink-3">{[step.blockedOwner ? `等待 ${step.blockedOwner}` : '', step.blockedFollowUpDate ? `${dayjs(step.blockedFollowUpDate).format('MM/DD')} 再追` : ''].filter(Boolean).join('・')}</p>
                <button type="button" onClick={() => setStatus(step, 'doing')} className="mt-2 min-h-10 w-full rounded-lg border border-ok/40 text-xs font-bold text-ok">問題解決了，繼續施工</button>
              </div>
            )}
            {open && (
              <div className="mt-2 grid gap-2 rounded-lg bg-s1 p-2.5">
                <label className="text-[11px] text-ink-3">廠商
                  <select value={step.supplierId || ''} onChange={(e) => patchStep(step, { supplierId: e.target.value })} className="mt-1 min-h-11 w-full text-sm">
                    <option value="">尚未指派廠商</option>
                    {suppliers.filter((row) => row.active !== false || row.id === step.supplierId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-ink-3">預計日期
                  <input type="date" value={step.plannedDate || ''} onChange={(e) => patchStep(step, { plannedDate: e.target.value })} className="mt-1 min-h-11 w-full text-sm" />
                </label>
                <label className="text-[11px] text-ink-3">備註
                  <input defaultValue={step.note || ''} onBlur={(e) => { if (e.target.value !== (step.note || '')) patchStep(step, { note: e.target.value }); }} className="mt-1 min-h-11 w-full text-sm" />
                </label>
                {!finished && step.status !== 'blocked' && !isFinal && (
                  <button type="button" onClick={() => setDialog({ type: 'blocked', step, reason: '', owner: supplier || '', followUp: dayjs().add(1, 'day').format('YYYY-MM-DD') })}
                    className="min-h-10 rounded-lg border border-danger/40 text-xs font-bold text-danger">標記受阻（卡住）</button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );

  return (
    <section id="case-sop" className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-ink">🚚 施工進度</h2>
          <p className="mt-0.5 text-[11px] text-ink-3">{delivered ? `已於 ${dayjs(deal.deliveredAt || caseItem?.completedAt || deal.date).format('YYYY/MM/DD')} 交車` : `完成 ${complete}/${workflow.length}・點圓圈就完成，點錯可按「復原」`}</p>
        </div>
        <span className="rounded-full bg-ok/12 px-3 py-1 text-xs font-bold text-ok">{delivered ? '已交車' : `${percent}%`}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-s3"><div className="h-full rounded-full bg-ok" style={{ width: `${delivered ? 100 : percent}%` }} /></div>
      {error && <p role="alert" className="mt-2 rounded-xl border border-danger/40 bg-danger/10 p-2.5 text-sm text-danger">{error}</p>}
      {delivered ? <details className="mt-3"><summary className="min-h-10 cursor-pointer py-2 text-sm font-bold text-ink-2">查看施工步驟</summary>{steps}</details> : steps}
      {!delivered && (
        <details className="mt-3 text-xs text-ink-2">
          <summary className="min-h-10 cursor-pointer py-2">更多：加步驟、重設流程</summary>
          <div className="mt-1 flex gap-2">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="例如：加裝行車紀錄器" className="min-h-11 flex-1 text-sm" aria-label="新增施工步驟名稱" />
            <button type="button" disabled={!newLabel.trim()} onClick={addStep} className="btn-outline min-h-11 shrink-0 disabled:opacity-40">加入</button>
          </div>
          <button type="button" onClick={() => setDialog({ type: 'reset' })} className="mt-2 min-h-10 w-full rounded-lg border border-danger/40 text-xs font-bold text-danger">重設施工流程</button>
        </details>
      )}

      {toast && (
        <div role="status" aria-live="polite" className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-[60] mx-auto flex max-w-lg items-center gap-2 rounded-2xl border border-ok/35 bg-s1 p-2.5 shadow-panel">
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">✓ {toast.message}</span>
          {toast.undo && <button type="button" onClick={toast.undo} className="min-h-11 rounded-xl border border-accent/40 px-3 text-sm font-bold text-accent">復原</button>}
          <button type="button" onClick={() => showToast(null)} aria-label="關閉提示" className="h-11 w-9 text-lg text-ink-3">×</button>
        </div>
      )}

      {dialog?.type === 'stock' && (
        <Sheet title={`還有 ${dialog.missing.length} 項配件沒備妥`} actions={<>
          <button type="button" onClick={() => { setDialog(null); onGoStock?.(); }} className="btn-primary min-h-12">先去核對</button>
          <button type="button" onClick={() => { const step = dialog.step; setDialog(null); if (isDeliveryFinalStep(step)) openDeliveryDialog(); else setStatus(step, 'done'); }} className="btn-outline min-h-12">仍要繼續</button>
        </>}>
          <p className="mt-1 text-sm text-ink-2">完成「{dialog.step.label}」之前，下面的配件還不是「已備妥／已安裝／不需備品」：</p>
          <ul className="mt-3 space-y-1.5 rounded-xl border border-copper/30 bg-copper/5 p-3 text-sm text-ink">
            {dialog.missing.map((item) => <li key={item.id}>・{item.name}{item.specification ? `（${item.specification}）` : ''}<span className="ml-1 text-xs text-copper">{STATUS_LABEL.get(item.status) || '未處理'}</span></li>)}
          </ul>
        </Sheet>
      )}

      {dialog?.type === 'blocked' && (
        <Sheet title={`「${dialog.step.label}」卡在哪裡？`} actions={<>
          <button type="button" onClick={() => setDialog(null)} className="btn-outline min-h-12">取消</button>
          <button type="button" disabled={!dialog.reason.trim() || !dialog.followUp} onClick={submitBlocked} className="btn-danger min-h-12 disabled:opacity-50">標記受阻</button>
        </>}>
          <div className="mt-3 space-y-3">
            <label className="block text-xs font-bold text-ink-2">卡住原因（必填）<textarea value={dialog.reason} onChange={(e) => setDialog({ ...dialog, reason: e.target.value })} rows={3} placeholder="例如：等待廠商確認施工日期" className="mt-1 w-full text-sm font-normal" /></label>
            <label className="block text-xs font-bold text-ink-2">目前在等誰<input value={dialog.owner} onChange={(e) => setDialog({ ...dialog, owner: e.target.value })} className="mt-1 min-h-11 w-full text-sm font-normal" /></label>
            <label className="block text-xs font-bold text-ink-2">哪一天再追（必填）<input type="date" value={dialog.followUp} onChange={(e) => setDialog({ ...dialog, followUp: e.target.value })} className="mt-1 min-h-11 w-full text-sm font-normal" /></label>
          </div>
        </Sheet>
      )}

      {dialog?.type === 'reset' && (
        <Sheet title="重設施工流程？" actions={<>
          <button type="button" onClick={() => setDialog(null)} className="btn-outline min-h-12">取消</button>
          <button type="button" onClick={resetFlow} className="btn-danger min-h-12">重設</button>
        </>}>
          <p className="mt-2 text-sm text-ink-2">會依成交的配件重新產生全部步驟，目前每一步的完成狀態、廠商與備註都會清掉。</p>
        </Sheet>
      )}

      {dialog?.type === 'deliver' && (
        <Sheet title="確認交車" actions={<>
          <button type="button" disabled={busy} onClick={() => setDialog(null)} className="btn-outline min-h-12 disabled:opacity-50">取消</button>
          <button type="button" disabled={busy} onClick={submitDelivery} className="btn-primary min-h-12 disabled:opacity-50">{busy ? '儲存中…' : '確認交車'}</button>
        </>}>
          <div className="mt-3 space-y-3 text-sm">
            <label className="block text-xs font-bold text-ink-2">交車日期
              <input type="date" value={dialog.date} onChange={(e) => setDialog({ ...dialog, date: e.target.value, annual: defaultAnnualReminders(e.target.value || today()) })} className="mt-1 min-h-11 w-full text-sm font-normal" />
            </label>
            <div className="rounded-xl border border-bdr bg-s2/70 p-3 text-xs text-ink-2">
              <p className="font-bold text-ink">確認後會：</p>
              <ul className="mt-1.5 space-y-1">
                <li>・案件改為「已完工交車」，結束追蹤、收掉成交前的待辦</li>
                <li>・自動建立 {DELIVERY_FOLLOWUP_DAYS.join(' / ')} 天售後回訪提醒{client ? '' : '（找不到客戶，不會建立）'}</li>
                <li>・購車案件會認列 {dayjs(dialog.date || today()).format('YYYY 年 M 月')} 薪資</li>
                {dialog.skipped.length > 0 && <li className="text-copper">・還沒做的 {dialog.skipped.length} 個步驟會標為略過：{dialog.skipped.join('、')}</li>}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold text-ink-2">年度商機提醒（日期可調）</p>
              {ANNUAL_REMINDER_DEFS.map(({ key, label }) => (
                <label key={key} className="mt-1.5 flex items-center gap-2 text-xs text-ink-2">
                  <input type="checkbox" checked={dialog.annual[key].on} onChange={(e) => setDialog({ ...dialog, annual: { ...dialog.annual, [key]: { ...dialog.annual[key], on: e.target.checked } } })} className="h-5 w-5" />
                  <span className="w-24 shrink-0">{label}</span>
                  <input type="date" value={dialog.annual[key].date} disabled={!dialog.annual[key].on} onChange={(e) => setDialog({ ...dialog, annual: { ...dialog.annual, [key]: { ...dialog.annual[key], date: e.target.value } } })} className="min-h-11 flex-1 text-sm disabled:opacity-40" />
                </label>
              ))}
            </div>
            {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-2.5 text-sm text-danger">{error}</p>}
          </div>
        </Sheet>
      )}
    </section>
  );
}

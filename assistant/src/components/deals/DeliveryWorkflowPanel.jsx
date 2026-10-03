import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import {
  DELIVERY_STATUS_OPTIONS, generateDeliveryWorkflow, getWaitingOn, mergeSuggestedWorkflow, normalizeDeliveryWorkflow,
} from '../../utils/delivery';

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function DeliveryWorkflowPanel({ deals, clients, pricingById, suppliers, onSaveDeal, onOpenPricing, focusDealId = null }) {
  const [openDealId, setOpenDealId] = useState(null);
  const [newStep, setNewStep] = useState({ label: '', service: '' });
  const [deleteStepId, setDeleteStepId] = useState(null);
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const sortedDeals = [...deals].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  useEffect(() => {
    if (focusDealId && deals.some((deal) => deal.id === focusDealId)) setOpenDealId(focusDealId);
  }, [focusDealId, deals]);

  function saveWorkflow(deal, workflow) {
    return onSaveDeal({ ...deal, deliveryWorkflow: workflow, deliveryWorkflowUpdatedAt: new Date().toISOString() });
  }

  function updateStep(deal, workflow, stepId, patch) {
    saveWorkflow(deal, workflow.map((step) => step.id === stepId
      ? { ...step, ...patch, updatedAt: new Date().toISOString() }
      : step));
  }

  function moveStep(deal, workflow, index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= workflow.length) return;
    const next = [...workflow];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    saveWorkflow(deal, next);
  }

  function addStep(deal, workflow) {
    if (!newStep.label.trim()) return;
    const previous = workflow.at(-1);
    saveWorkflow(deal, [...workflow, {
      id: makeId(), label: newStep.label.trim(), service: newStep.service.trim() || '其他',
      dependsOn: previous?.id || null, status: 'todo', supplierId: '', plannedDate: '', cost: '', note: '',
    }]);
    setNewStep({ label: '', service: '' });
  }

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <h2 className="font-bold text-ink">🚚 成交後施工進度</h2>
        <p className="text-xs text-ink-3 mt-1">依成交配備建立流程；尾門與帆布可同時聯繫，施工則依前置工作接續。每一步都可改順序、廠商、日期與狀態。</p>
      </div>
      {sortedDeals.length === 0 && <p className="card p-6 text-center text-sm text-ink-3">尚無成交案件；建立成交案後即可安排施工。</p>}
      {sortedDeals.map((deal) => {
        const workflow = normalizeDeliveryWorkflow(deal);
        const complete = workflow.filter((step) => ['done', 'na'].includes(step.status)).length;
        const pricing = pricingById.get(`deal:${deal.id}`);
        const isOpen = openDealId === deal.id;
        return (
          <section key={deal.id} className={`card overflow-hidden ${focusDealId === deal.id ? 'ring-2 ring-copper/40' : ''}`}>
            <button type="button" onClick={() => { setOpenDealId(isOpen ? null : deal.id); setNewStep({ label: '', service: '' }); }}
              className="w-full flex items-center justify-between gap-3 p-3 text-left">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink truncate">{clientNames.get(deal.clientId) || deal.clientName || '未連結客戶'}・{deal.model || deal.note || '車輛'}</span>
                <span className="block text-[11px] text-ink-3">{deal.date ? dayjs(deal.date).format('YYYY/MM/DD') : '日期未填'}・{workflow.length ? `已完成 ${complete}/${workflow.length}` : '尚未建立流程'}</span>
              </span>
              <span className="shrink-0 text-xs text-accent font-semibold">{workflow.length ? `${Math.round(complete / workflow.length * 100)}%` : '建立'} {isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div className="border-t border-bdr p-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => saveWorkflow(deal, mergeSuggestedWorkflow(workflow, generateDeliveryWorkflow({ deal, pricing })))} className="btn-primary text-xs">
                    {workflow.length ? '＋ 補上成交建議步驟' : '依成交內容建立流程'}
                  </button>
                  <button type="button" onClick={() => onOpenPricing(deal)} className="btn-outline text-xs">查看成本與成交配備</button>
                </div>
                {workflow.length === 0 && <p className="rounded-lg bg-s2 p-3 text-xs text-ink-3">按「依成交內容建立流程」，系統會從成交配備辨識尾門、帆布、烤漆、H 架或箱體；建立後仍可手動調整。</p>}
                {workflow.map((step, index) => {
                  const waiting = getWaitingOn(step, workflow);
                  const matchedSuppliers = suppliers.filter((supplier) => supplier.active !== false
                    && (!(supplier.services || []).length || (supplier.services || []).some((service) => step.service.includes(service) || service.includes(step.service))));
                  const supplierOptions = matchedSuppliers.length ? matchedSuppliers : suppliers.filter((supplier) => supplier.active !== false);
                  return (
                    <article key={step.id} className={`rounded-xl border p-3 space-y-2 ${waiting ? 'border-amber-300 bg-amber-50/50' : 'border-bdr bg-s2/40'}`}>
                      <div className="flex items-start gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-bold text-accent">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-ink">{step.label}</p>
                          <p className="text-[10px] text-ink-3">{step.service || '其他'}{waiting ? `・等待「${waiting.label}」完成` : ''}</p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button type="button" disabled={index === 0} onClick={() => moveStep(deal, workflow, index, -1)} className="btn-outline px-1.5 py-0.5 text-[10px] disabled:opacity-30" aria-label={`上移${step.label}`}>↑</button>
                          <button type="button" disabled={index === workflow.length - 1} onClick={() => moveStep(deal, workflow, index, 1)} className="btn-outline px-1.5 py-0.5 text-[10px] disabled:opacity-30" aria-label={`下移${step.label}`}>↓</button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select value={step.status} onChange={(event) => updateStep(deal, workflow, step.id, { status: event.target.value })} aria-label={`${step.label}狀態`} className="text-xs">
                          {DELIVERY_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <select value={step.supplierId || ''} onChange={(event) => updateStep(deal, workflow, step.id, { supplierId: event.target.value })} aria-label={`${step.label}廠商`} className="text-xs">
                          <option value="">未指派廠商</option>
                          {supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                        </select>
                        <label className="text-[10px] text-ink-3">預計日期<input type="date" value={step.plannedDate || ''} onChange={(event) => updateStep(deal, workflow, step.id, { plannedDate: event.target.value })} className="mt-1 w-full text-xs" /></label>
                        <label className="text-[10px] text-ink-3">成本／廠商報價<input inputMode="numeric" value={step.cost ?? ''} onChange={(event) => updateStep(deal, workflow, step.id, { cost: event.target.value.replace(/[^0-9]/g, '') })} placeholder="尚未確認" className="mt-1 w-full text-xs" /></label>
                        <label className="sm:col-span-2 text-[10px] text-ink-3">前置工作
                          <select value={step.dependsOn || ''} onChange={(event) => updateStep(deal, workflow, step.id, { dependsOn: event.target.value || null })} className="mt-1 w-full text-xs">
                            <option value="">可獨立／可同時進行</option>
                            {workflow.filter((candidate) => candidate.id !== step.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                          </select>
                        </label>
                      </div>
                      <textarea value={step.note || ''} onChange={(event) => updateStep(deal, workflow, step.id, { note: event.target.value })} rows={2} placeholder="聯繫結果、施工地址、注意事項或進度備註" className="w-full text-xs" />
                      <div className="flex justify-end">
                        {deleteStepId === step.id ? (
                          <span className="flex gap-2"><button type="button" onClick={() => setDeleteStepId(null)} className="btn-outline text-[10px]">取消</button><button type="button" onClick={() => { saveWorkflow(deal, workflow.filter((row) => row.id !== step.id).map((row) => row.dependsOn === step.id ? { ...row, dependsOn: null } : row)); setDeleteStepId(null); }} className="btn-danger text-[10px]">確認刪除此工作</button></span>
                        ) : <button type="button" onClick={() => setDeleteStepId(step.id)} className="text-[10px] text-danger/60 hover:text-danger">刪除此工作</button>}
                      </div>
                    </article>
                  );
                })}
                <div className="rounded-xl border border-dashed border-accent/40 p-3">
                  <p className="mb-2 text-xs font-bold text-ink">＋ 新增自訂工作</p>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-2">
                    <input value={newStep.label} onChange={(event) => setNewStep((current) => ({ ...current, label: event.target.value }))} placeholder="例如：安裝冷凍機" className="text-xs" />
                    <input value={newStep.service} onChange={(event) => setNewStep((current) => ({ ...current, service: event.target.value }))} placeholder="工作類型" className="text-xs" />
                    <button type="button" onClick={() => addStep(deal, workflow)} className="btn-outline text-xs">加入流程</button>
                  </div>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

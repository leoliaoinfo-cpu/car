import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { CASE_LIST_FILTERS, caseStagePill, caseTrackingParts, compareCaseTracking, getCaseTracking, matchesCaseListFilter } from '../../utils/tracking';
import { useApp } from '../../context';
import {
  advanceCasePipeline, buildWorkQueue, CASE_PIPELINE_STAGES, CASE_TYPE_LABEL, getCasePipelineElapsedDays, getCasePipelineStage, getCasePipelineStageId, getCasePipelineUpdatedAt, getCaseStatusLabel, getCaseTotalElapsedDays, resolveCaseFollowUpTarget, findDealForCase, CASE_CLOSE_REASONS, findPossibleDuplicateCases, applyCaseContact, CONTACT_PRESETS, isOpenCase,
  carMonthLabel, isAwaitingCar, startAwaitingCar, markCarArrived, stopAwaitingCar,
} from '../../utils/cases';
import { addDays, today } from '../../utils/date';
import { formatMoney, generateId } from '../../utils/crm';
import { normalizeDeliveryWorkflow } from '../../utils/delivery';
import CaseDeliveryChecklist from '../deals/CaseDeliveryChecklist';
import OptionSheet from './OptionSheet';
import MasterPinDialog from '../MasterPinDialog';
import ClientPhotos from '../crm/ClientPhotos';
import { sheetHasContent, normalizeSheet } from '../../utils/optionSheet';
import { ClientPicker, ConfirmDeleteButton, ChipSelect } from '../ui';
import {
  stockAlert, stockByCase, stockByKind, unlistedStockItems, vendorSequence, supplierForItem, statusOptions, stockStatus, statusLabel, nextStatus, isSettledStock, stockTrack, switchTrack, statusPatch, TRACK_LABELS,
} from '../../utils/stock';

const STATUS_FILTERS = [...CASE_LIST_FILTERS, ['deleted', '回收筒']];
// 狀態標籤的顏色：一眼分得出洽談／成交／交車（粗體＋深色外框）
const STAGE_PILL = {
  new: 'bg-teal text-on-accent', follow_up: 'bg-gold text-black', won: 'bg-copper text-white',
  delivery: 'bg-accent text-on-accent', completed: 'bg-ok text-white', closed: 'bg-ink-3 text-white',
};

export default function CasesPage({ focusId, startNewToken, initialClientId, onFocusConsumed, onStartConsumed, onNewClosed, onDetailClosed, onOpenClient, onOpenQuote, onOpenOperations }) {
  const { cases, deletedCases = [], workItems, activities, tasks, clients, deals, quoteDrafts, quotePresets, events, cats, stages, saveCase, saveDeal, deleteCase, restoreCase, saveWorkItem, saveActivity, saveClient, saveTask, updateClient } = useApp();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  // 從「今天」等其他頁面直接開進來的案件，按返回時要回到原本那一頁（由 App 決定）。
  const openedByFocus = useRef(false);
  const [showNew, setShowNew] = useState(false);
  const [restoringId, setRestoringId] = useState(null);
  const [restoreError, setRestoreError] = useState('');
  const [showStock, setShowStock] = useState(false);
  const [showDup, setShowDup] = useState(false);
  const dupGroups = useMemo(() => findPossibleDuplicateCases(cases), [cases]);
  // 全部進行中成交案件還缺幾項配件；沒有缺就不顯示點貨入口，畫面少一條。
  const missingStockCount = useMemo(() => deals.reduce((sum, deal) => {
    if (!deal.quoteId || deal.caseArchivedAt) return sum;
    const linkedCase = cases.find((row) => row.id === deal.caseId || row.dealId === deal.id);
    if (!linkedCase || !isOpenCase(linkedCase)) return sum;
    return sum + (stockAlert(deal, linkedCase).missing || 0);
  }, 0), [deals, cases]);

  useEffect(() => {
    if (focusId) { openedByFocus.current = true; setSelectedId(focusId); onFocusConsumed?.(); }
  }, [focusId, onFocusConsumed]);
  useEffect(() => {
    if (startNewToken) { setShowNew(true); onStartConsumed?.(); }
  }, [startNewToken, onStartConsumed]);

  const workQueue = useMemo(() => buildWorkQueue({ workItems, tasks, clients, deals, cases, events }), [workItems, tasks, clients, deals, cases, events]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = filter === 'deleted' ? deletedCases : cases;
    const withTracking = [...source].map((row) => ({ item: row, tracking: filter === 'deleted' ? null : getCaseTracking(row, { deals, quotes: quoteDrafts, queue: workQueue }) }));
    const sorted = withTracking
      .filter(({ item: row, tracking }) => filter === 'deleted' || matchesCaseListFilter(filter, tracking))
      .filter(({ item: row }) => {
        if (!needle) return true;
        const client = clients.find((item) => item.id === row.clientId);
        const linkedDeal = deals.find((item) => item.id === row.dealId || item.caseId === row.id);
        const linkedQuotes = quoteDrafts.filter((item) => !item.archivedAt && ((row.quoteIds || []).includes(item.id) || item.caseId === row.id));
        return [row.clientName, row.title, CASE_TYPE_LABEL[row.type], getCaseStatusLabel(row), row.nextFollowUpDate,
          getCasePipelineStage(row, { deals, quotes: quoteDrafts }), client?.phone, client?.lineId, client?.company, client?.plate, client?.licensePlate,
          linkedDeal?.model, ...linkedQuotes.map((item) => item.model)]
          .some((value) => String(value || '').toLowerCase().includes(needle));
      })
      .sort((a, b) => (filter === 'deleted' ? String(b.item.deletedAt || '').localeCompare(String(a.item.deletedAt || '')) : compareCaseTracking(a, b)));
    return sorted;
  }, [cases, deletedCases, clients, deals, filter, query, quoteDrafts, workQueue]);
  const selected = cases.find((row) => row.id === selectedId);

  return (
    <div className="max-w-4xl mx-auto px-3 md:px-5 py-4 md:py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink">案件</h1>
        <button type="button" onClick={() => setShowNew(true)} className="btn-primary min-h-11 shrink-0">＋ 新案件</button>
      </div>

      {dupGroups.length > 0 && <button type="button" onClick={() => setShowDup(true)} className="min-h-12 w-full rounded-xl border border-warn/50 bg-warn/10 px-4 text-left text-sm font-bold text-warn">⚠ {dupGroups.map((g) => g.clientName).slice(0, 3).join('、')}{dupGroups.length > 3 ? '等' : ''} 有案件可能重複・點這裡整理</button>}
      {(showStock || missingStockCount > 0) && <button type="button" onClick={() => setShowStock((value) => !value)} className={`min-h-12 w-full rounded-xl border px-4 text-left text-sm font-bold ${showStock ? 'border-copper bg-copper/12 text-copper' : 'border-bdr bg-s1 text-ink'}`}>📦 {showStock ? '返回案件列表' : `尚缺配件 ${missingStockCount} 項・點我看要叫哪些貨`}</button>}
      {showStock ? <StockCenter deals={deals} cases={cases} quotes={quoteDrafts} addons={quotePresets?.addons || []} onSaveDeal={saveDeal} onOpenCase={(id) => { setShowStock(false); openedByFocus.current = false; setSelectedId(id); }} /> : <>

      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋姓名、電話、車牌、車型或案件名稱…" className="w-full min-h-11" />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTERS.map(([key, label]) => {
          const count = key === 'deleted' ? deletedCases.length : cases.filter((row) => matchesCaseListFilter(key, getCaseTracking(row, { deals, quotes: quoteDrafts, queue: workQueue }))).length;
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
          {rows.map(({ item, tracking }) => {
            if (filter === 'deleted') return (
              <article key={item.id} className="card border-danger/25 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5"><span className="badge bg-danger/10 text-danger">已刪除</span><span className={`badge ${item.type === 'modification' ? 'bg-warn text-black' : 'bg-danger text-white'}`}>{CASE_TYPE_LABEL[item.type] || '案件'}</span></div>
                    <h2 className="mt-2 truncate font-bold text-ink">{item.clientName || '未命名客戶'}</h2>
                    <p className="truncate text-sm text-ink-2">{item.title || '未命名案件'}</p>
                    <p className="mt-1 text-[11px] text-ink-3">刪除於 {dayjs(item.deletedAt).format('YYYY/MM/DD HH:mm')}</p>
                  </div>
                  <button type="button" disabled={restoringId === item.id} onClick={async () => { setRestoringId(item.id); setRestoreError(''); try { await restoreCase(item.id); } catch (cause) { setRestoreError(cause?.message || '案件恢復失敗。'); } finally { setRestoringId(null); } }} className="btn-outline min-h-11 shrink-0 text-xs">{restoringId === item.id ? '恢復中…' : '↶ 恢復'}</button>
                </div>
              </article>
            );
            const caseActions = workQueue.filter((row) => row.caseId === item.id);
            const deal = findDealForCase(deals, item);
            const stock = stockAlert(deal, item);
            const action = caseActions.find((row) => row.state !== 'waiting') || caseActions[0];
            const pipelineStageId = getCasePipelineStageId(item, { deals, quotes: quoteDrafts });
            const pipelineStage = getCasePipelineStage(item, { deals, quotes: quoteDrafts });
            const stageUpdatedAt = getCasePipelineUpdatedAt(item, { deals, quotes: quoteDrafts });
            const stageDays = getCasePipelineElapsedDays(item, { deals, quotes: quoteDrafts });
            const totalDays = getCaseTotalElapsedDays(item, { deals, quotes: quoteDrafts });
            return (
              <div key={item.id} className={`card text-left transition-all ${tracking && (matchesCaseListFilter('won', tracking) || matchesCaseListFilter('delivered', tracking)) ? 'border-danger/35 bg-danger/10' : 'hover:border-teal/50'}`}>
                <button type="button" onClick={() => { openedByFocus.current = false; setSelectedId(item.id); }} className="block w-full p-4 text-left active:scale-[0.99] transition-all">

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className={`badge ${item.type === 'modification' ? 'bg-warn text-black' : 'bg-danger text-white'}`}>{CASE_TYPE_LABEL[item.type] || '案件'}</span>
                      {tracking && (() => { const pill = caseStagePill(item, tracking); return <span className={`rounded-md border-2 border-ink px-2 py-0.5 text-xs font-extrabold leading-tight ${STAGE_PILL[pill.tone] || STAGE_PILL.new}`}>{pill.text}</span>; })()}
                      {isAwaitingCar(item) && <span className="rounded-md border-2 border-copper bg-copper/10 px-2 py-0.5 text-xs font-extrabold leading-tight text-copper">🚚 等車中{item.expectedCarMonth ? `・${carMonthLabel(item.expectedCarMonth)}` : ''}</span>}
                      {pipelineStageId === 'completed' && dayjs(stageUpdatedAt).isValid() && <span className="badge bg-ok/15 text-ok">{dayjs(stageUpdatedAt).format('YYYY 年 MM 月')}交車</span>}
                    </div>
                    <h2 className="font-bold text-ink mt-2 truncate">{item.clientName || '未命名客戶'}</h2>
                    <p className="text-sm text-ink-2 truncate">{item.title || '未命名案件'}</p>
                  </div>
                  <span className="text-ink-3">›</span>
                </div>
                <p className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-2 empty:hidden">
                  {caseTrackingParts(item, tracking).filter((part) => part.key !== 'stage').map((part) => (
                    <span key={part.key} className={part.tone === 'danger' ? 'font-bold text-danger' : part.tone === 'warn' ? 'font-semibold text-gold' : ''}>{part.text}</span>
                  ))}
                </p>
                {deal?.quoteId && !stock.delivered && <p className={`mt-2 text-xs font-bold ${stock.deliveryRisk ? 'text-danger' : stock.missing ? 'text-copper' : 'text-ok'}`}>📦 {stock.missing ? `尚缺 ${stock.missing} 項配件${stock.deliveryRisk ? '・交車將近' : ''}` : '配件已核對完成'}{stock.inquiryNoDate ? '・待廠商確認未排再追日' : ''}</p>}
                </button>
                {tracking && tracking.completed && !tracking.closed && (
                  <div className="border-t border-bdr/60 px-4 py-2">
                    {tracking.filed
                      ? <button type="button" onClick={() => saveCase({ ...item, filedAt: '' })} className="min-h-10 text-xs font-bold text-ink-2 underline underline-offset-2">↩ 放回「全部」</button>
                      : <button type="button" onClick={() => saveCase({ ...item, filedAt: new Date().toISOString() })} className="min-h-10 rounded-lg border-2 border-ink bg-s1 px-3 text-xs font-extrabold text-ink">📁 歸到已交車（移出全部）</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </>}

      {showDup && <DuplicateCasesModal groups={dupGroups} deals={deals} quotes={quoteDrafts} onClose={() => setShowDup(false)} onTrash={deleteCase} />}
      {showNew && <NewCaseModal clients={clients} cats={cats} stages={stages} initialClientId={initialClientId} onClose={() => { setShowNew(false); onNewClosed?.(); }} onSaveCase={saveCase} onSaveClient={saveClient} onSaveWorkItem={saveWorkItem} onSaveActivity={saveActivity} onCreated={(id, opts) => { setShowNew(false); onNewClosed?.(); if (opts?.quote && opts.item) onOpenQuote?.(opts.item, null); else setSelectedId(id); }} />}
      {selected && <CaseDetail key={selected.id} item={selected} workItems={workItems} tasks={tasks} caseQueue={workQueue.filter((row) => row.caseId === selected.id)} activities={activities} deals={deals} quotes={quoteDrafts} phone={clients.find((row) => row.id === selected.clientId)?.phone || ''} onClose={() => { setSelectedId(null); if (openedByFocus.current) { openedByFocus.current = false; onDetailClosed?.(); } }} onSaveCase={saveCase} onSaveDeal={saveDeal} onDeleteCase={deleteCase} onSaveWorkItem={saveWorkItem} onSaveActivity={saveActivity} onSaveTask={saveTask} onUpdateClient={updateClient} onOpenClient={onOpenClient} onOpenQuote={onOpenQuote} onOpenOperations={onOpenOperations} />}
    </div>
  );
}

/** 狀態用勾選按鈕一排排開（不用下拉選單）：目前狀態實心，點哪個就改成哪個。 */
function StatusChips({ row, disabled, label, onPick }) {
  const current = stockStatus(row);
  return (
    <div role="radiogroup" aria-label={label} className="flex min-w-0 flex-wrap gap-1.5">
      {statusOptions(row).map(([id, text]) => {
        const on = id === current;
        return (
          <button key={id} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => { if (!on) onPick(id); }}
            className={`flex min-h-11 items-center gap-1.5 rounded-lg border-2 px-3 text-sm font-bold ${on ? 'border-copper bg-copper text-white' : 'border-bdr bg-s1 text-ink-2'}`}>
            <span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded border-2 text-[10px] ${on ? 'border-white bg-white/25 text-white' : 'border-ink-3/60 text-transparent'}`}>✓</span>{text}
          </button>
        );
      })}
    </div>
  );
}

function StockActions({ row, disabled, onChange, awaiting = false }) {
  const next = nextStatus(row);
  const settled = isSettledStock(row);
  // 等車中不自動排「3 天後再追」，不然車還沒到就一直被催
  const follow = awaiting ? '' : addDays(today(), 3);
  return (
    <div className="mt-2 flex flex-col gap-2">
      <StatusChips row={row} disabled={disabled} label={`${row.name}狀態`} onPick={(id) => onChange(statusPatch(row, id, follow))} />
      {next
        ? <button type="button" disabled={disabled} onClick={() => onChange(statusPatch(row, next[0], follow))}
          className={`min-h-10 w-full rounded-lg border px-3 text-xs font-bold ${settled ? 'border-ok bg-ok/10 text-ok' : 'border-copper bg-copper/10 text-copper'}`}>→ {next[1]}</button>
        : <span className="flex min-h-10 items-center justify-center rounded-lg bg-ok/10 px-3 text-xs font-bold text-ok">✓ 完成</span>}
    </div>
  );
}

/** 廠商施工先後順序（第 N 步）與對應廠商（廠商名冊裡承作項目有這個配件的），讓你一眼知道先做哪個、找誰。 */
function VendorInfo({ row, seq, suppliers }) {
  const supplier = stockTrack(row) === 'vendor' ? supplierForItem(row, suppliers) : null;
  if (!seq && !supplier) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-2">
      {seq ? <span className="badge border border-copper/50 bg-copper/10 font-bold text-copper">第 {seq} 步</span> : null}
      {supplier ? <span>🤝 {supplier.name}{supplier.contact ? `・${supplier.contact}` : ''}{supplier.phone ? <a href={`tel:${supplier.phone}`} className="ml-1 font-bold text-accent" aria-label={`撥打${supplier.name}`}>📞</a> : null}</span> : null}
    </p>
  );
}

function CarBadge({ entry }) {
  if (!entry?.awaiting) return null;
  const label = carMonthLabel(entry.expectedCarMonth);
  return <span className="badge border border-copper/50 bg-copper/10 text-copper">🚚 等車中{label ? `・${label}` : ''}</span>;
}

function StockCenter({ deals, cases, quotes = [], addons = [], onOpenCase, onSaveDeal }) {
  const { suppliers = [] } = useApp();
  const [mode, setMode] = useState('customer');
  const [who, setWho] = useState(''); // 只看某位客戶（案件 id）；空白＝全部
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [batch, setBatch] = useState(null); // { key, status }：等待確認的整區批次
  const all = useMemo(() => stockByCase(deals, cases), [deals, cases]);
  const list = useMemo(() => all.filter((entry) => (!who || entry.caseId === who) && (!onlyUrgent || entry.urgent)), [all, who, onlyUrgent]);
  const groups = useMemo(() => stockByKind(list), [list]);
  const urgentCount = all.filter((entry) => entry.urgent).length;
  // 報價裡有、但配件核對表還沒列入的項目（例：以前「其他費用」裡打的帆布沒被算進來）
  const unlisted = useMemo(() => {
    const open = new Map(cases.filter((item) => !item.deletedAt && !['completed', 'closed'].includes(item.status)).map((item) => [item.id, item]));
    return deals.filter((deal) => deal.quoteId && !deal.caseArchivedAt && open.has(deal.caseId))
      .map((deal) => ({ deal, clientName: deal.clientName || open.get(deal.caseId)?.clientName || '未命名客戶', items: unlistedStockItems(deal, deal.quoteSnapshot || quotes.find((q) => q.id === deal.quoteId), addons) }))
      .filter((row) => row.items.length);
  }, [deals, cases, quotes, addons]);
  async function addUnlisted() {
    setSaving('unlisted'); setError('');
    try {
      const stamp = new Date().toISOString();
      for (const { deal, items } of unlisted) await onSaveDeal({ ...deal, stockItems: [...(deal.stockItems || []), ...items.map((it) => ({ ...it, updatedAt: stamp }))] });
    } catch (cause) { setError(cause?.message || '儲存失敗，請再試一次'); }
    finally { setSaving(''); }
  }
  const unverified = deals.filter((deal) => !deal.quoteId && !deal.caseArchivedAt && cases.some((item) => (item.id === deal.caseId || item.dealId === deal.id) && item.status !== 'completed'));

  async function change(entry, rowId, patch) {
    setSaving(rowId); setError('');
    try {
      const stamp = new Date().toISOString();
      await onSaveDeal({ ...entry.deal, stockItems: (entry.deal.stockItems || []).map((it) => (it.id === rowId ? { ...it, ...patch, updatedAt: stamp } : it)) });
    } catch (cause) { setError(cause?.message || '儲存失敗，請再試一次'); }
    finally { setSaving(''); }
  }

  // 整區一次改狀態（例：這 3 位客人的帆布一起「已聯繫廠商」）：同一台車的項目合併成一次存檔
  async function applyBatch(group, status) {
    setSaving(`batch:${group.key}`); setError('');
    try {
      const stamp = new Date().toISOString();
      const byDeal = new Map();
      for (const row of group.rows) {
        const list = byDeal.get(row.dealId) || { deal: row.deal, patches: new Map() };
        list.patches.set(row.id, statusPatch(row, status, row.awaiting ? '' : addDays(today(), 3)));
        byDeal.set(row.dealId, list);
      }
      for (const { deal, patches } of byDeal.values()) {
        await onSaveDeal({ ...deal, stockItems: (deal.stockItems || []).map((it) => (patches.has(it.id) ? { ...it, ...patches.get(it.id), updatedAt: stamp } : it)) });
      }
      setBatch(null);
    } catch (cause) { setError(cause?.message || '儲存失敗，請再試一次'); }
    finally { setSaving(''); }
  }

  return (
    <section className="space-y-3">
      <div className="card p-4">
        <h2 className="font-bold text-ink">尚缺配件</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-3">只列已指定成交報價、還沒完工的案件。直接在這裡改狀態，不用進案件。外包：未聯繫→已聯繫→廠商已施作→已確認→已回報客戶；改裝部：缺貨→已叫貨→已到貨→已安裝。</p>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-bdr bg-s2 p-1">
          {[['customer', '依客戶'], ['part', '依配件（同類一起處理）']].map(([key, label]) => <button key={key} type="button" onClick={() => setMode(key)} className={`min-h-10 rounded-lg text-xs font-bold ${mode === key ? 'bg-teal text-on-accent' : 'text-ink-2'}`}>{label}</button>)}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ChipSelect aria-label="只看某位客戶" value={who} onChange={(e) => setWho(e.target.value)} className="min-h-11 min-w-0 flex-1 text-sm">
            <option value="">全部客戶（{all.length}）</option>
            {all.map((entry) => <option key={entry.caseId} value={entry.caseId}>{entry.clientName}{entry.urgent ? '・急' : entry.awaiting ? `・等車${entry.expectedCarMonth ? ` ${carMonthLabel(entry.expectedCarMonth)}` : ''}` : ''}</option>)}
          </ChipSelect>
          <button type="button" aria-pressed={onlyUrgent} onClick={() => setOnlyUrgent((v) => !v)} disabled={urgentCount === 0 && !onlyUrgent}
            className={`min-h-11 shrink-0 rounded-lg border px-3 text-xs font-bold disabled:opacity-40 ${onlyUrgent ? 'border-danger bg-danger text-white' : 'border-bdr bg-s1 text-ink-2'}`}>只看急件（{urgentCount}）</button>
        </div>
      </div>
      {unlisted.length > 0 && (
        <div className="rounded-xl border border-warn/50 bg-warn/15 p-3 text-xs text-black">
          <p className="font-bold">報價上有 {unlisted.reduce((n, row) => n + row.items.length, 0)} 項還沒帶進配件核對（所以這裡看不到），帶進去後由你判斷隱藏或刪除：</p>
          <ul className="mt-1 space-y-0.5">{unlisted.map((row) => <li key={row.deal.id}>・{row.clientName}：{row.items.map((it) => it.name).join('、')}</li>)}</ul>
          <button type="button" disabled={saving === 'unlisted'} onClick={addUnlisted} className="btn-primary mt-2 min-h-11 w-full text-sm font-bold disabled:opacity-50">{saving === 'unlisted' ? '加入中…' : '全部帶進配件核對'}</button>
        </div>
      )}
      {unverified.length > 0 && <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn">另有 {unverified.length} 筆舊成交尚未指定成交報價，配件需求未納入統計，請先核對。</p>}
      {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs font-semibold text-danger">{error}</p>}

      {mode === 'customer' && (list.length === 0
        ? <p className="card p-4 text-sm text-ink-2">{who || onlyUrgent ? '這個條件下沒有待處理的配件。' : '目前沒有待處理的配件。'}</p>
        : list.map((entry) => (
          <article key={entry.caseId} className={`card p-4 ${entry.urgent ? 'border-danger/50' : ''}`}>
            <button type="button" onClick={() => onOpenCase(entry.caseId)} className="flex w-full items-start justify-between gap-2 text-left">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-base font-bold text-ink">{entry.clientName}{entry.urgent && <span className="badge bg-danger text-white">急</span>}<CarBadge entry={entry} /></p>
                <p className="text-xs text-ink-3">{entry.deliveryDate ? `交車 ${dayjs(entry.deliveryDate).format('M/D')}${entry.days != null ? (entry.days < 0 ? `（已逾 ${-entry.days} 天）` : entry.days === 0 ? '（今天）' : `（${entry.days} 天後）`) : ''}` : entry.awaiting ? '車還沒到，到貨日還不確定' : '還沒排交車日'}</p>
              </div>
              <strong className={`shrink-0 text-sm ${entry.missing ? 'text-danger' : 'text-ok'}`}>{entry.missing ? `還差 ${entry.missing} 樣` : '都到齊了'} ›</strong>
            </button>
            <div className="mt-2 space-y-2">
              {entry.rows.map((row) => (
                <div key={row.id} className={`rounded-xl border border-bdr p-3 ${row.gift ? 'bg-s1 opacity-80' : 'bg-s2'}`}>
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-ink">
                    <span className={`badge ${stockTrack(row) === 'vendor' ? 'bg-copper/15 text-copper' : 'bg-teal/15 text-teal'}`}>{TRACK_LABELS[stockTrack(row)]}</span>
                    {row.name}{row.specification ? `・${row.specification}` : ''}{(Number(row.quantity) || 1) > 1 ? ` × ${row.quantity}` : ''}
                    {row.gift && <span className="text-[11px] font-normal text-ink-3">贈品</span>}
                  </p>
                  {row.note && <p className="mt-0.5 text-[11px] text-ink-3">{row.note}</p>}
                  <VendorInfo row={row} seq={row.seq} suppliers={suppliers} />
                  <StockActions row={row} awaiting={entry.awaiting} disabled={saving === row.id} onChange={(patch) => change(entry, row.id, patch)} />
                  {stockStatus(row) === 'inquiry' && row.followUpDate && <p className="mt-1 text-[11px] text-ink-3">再追日 {dayjs(row.followUpDate).format('M/D')}</p>}
                </div>
              ))}
            </div>
          </article>
        )))}

      {mode === 'part' && (groups.length === 0
        ? <p className="card p-4 text-sm text-ink-2">{who || onlyUrgent ? '這個條件下沒有待處理的配件。' : '目前沒有待備的配件。'}</p>
        : groups.map((group) => {
          const options = statusOptions(group.rows[0]).filter(([id]) => id !== 'not_needed');
          const picked = batch?.key === group.key ? batch.status : '';
          const batchLabel = options.find(([id]) => id === picked)?.[1] || '';
          return (
            <div key={group.key} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-base font-bold text-ink">
                    <span className={`badge ${group.track === 'vendor' ? 'bg-copper/15 text-copper' : 'bg-teal/15 text-teal'}`}>{TRACK_LABELS[group.track]}</span>{group.label}
                  </p>
                  <p className="text-xs text-ink-3">{group.rows.length} 項・{new Set(group.rows.map((row) => row.caseId)).size} 位客戶</p>
                </div>
                <strong className={`shrink-0 text-sm ${group.missing ? 'text-danger' : 'text-ok'}`}>{group.missing ? `尚缺 ${group.missing}` : '都到齊了'}</strong>
              </div>
              <div className="mt-2 space-y-2">
                {group.rows.map((row) => (
                  <div key={`${row.dealId}:${row.id}`} className="rounded-xl border border-bdr bg-s2 p-3">
                    <button type="button" onClick={() => onOpenCase(row.caseId)} className="flex w-full flex-wrap items-center gap-1.5 text-left text-sm font-bold text-ink">
                      {row.clientName || '未命名客戶'}{row.urgent && <span className="badge bg-danger text-white">急</span>}
                      {row.awaiting && <CarBadge entry={{ awaiting: true, expectedCarMonth: row.expectedCarMonth }} />}
                      {row.gift && <span className="text-[11px] font-normal text-ink-3">贈品</span>}
                      <span className="ml-auto text-ink-3">›</span>
                    </button>
                    <p className="mt-0.5 text-xs text-ink-2">{row.name}{row.specification ? `・${row.specification}` : ''}{(Number(row.quantity) || 1) > 1 ? ` × ${row.quantity}` : ''}</p>
                    {row.note && <p className="text-[11px] text-ink-3">{row.note}</p>}
                    <VendorInfo row={row} seq={null} suppliers={suppliers} />
                    <StockActions row={row} awaiting={row.awaiting} disabled={saving === row.id || saving === `batch:${group.key}`} onChange={(patch) => change({ deal: row.deal }, row.id, patch)} />
                    {stockStatus(row) === 'inquiry' && row.followUpDate && <p className="mt-1 text-[11px] text-ink-3">再追日 {dayjs(row.followUpDate).format('M/D')}</p>}
                  </div>
                ))}
              </div>
              {group.rows.length > 1 && (
                <div className="mt-3 rounded-xl border border-dashed border-bdr p-2.5">
                  <p className="text-[11px] font-bold text-ink-2">這一區全部一起改（{group.rows.length} 項）</p>
                  <div className="mt-1.5 space-y-2">
                    <div role="radiogroup" aria-label={`${group.label}整區改成`} className="flex flex-wrap gap-1.5">
                      {options.map(([id, label]) => {
                        const on = picked === id;
                        return (
                          <button key={id} type="button" role="radio" aria-checked={on} onClick={() => setBatch({ key: group.key, status: on ? '' : id })}
                            className={`flex min-h-11 items-center gap-1.5 rounded-lg border-2 px-3 text-sm font-bold ${on ? 'border-accent bg-accent text-on-accent' : 'border-bdr bg-s1 text-ink-2'}`}>
                            <span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded border-2 text-[10px] ${on ? 'border-white bg-white/25 text-white' : 'border-ink-3/60 text-transparent'}`}>✓</span>{label}
                          </button>
                        );
                      })}
                    </div>
                    <button type="button" disabled={!picked || saving === `batch:${group.key}`} onClick={() => setBatch({ key: group.key, status: picked, confirm: true })}
                      className="min-h-11 w-full rounded-lg border border-accent bg-accent/10 px-3 text-sm font-bold text-accent disabled:opacity-40">{picked ? `套用：全部改成「${batchLabel}」` : '先選要改成的狀態'}</button>
                  </div>
                  {batch?.key === group.key && batch.confirm && picked && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-warn/15 p-2 text-xs font-bold text-black">
                      <span className="min-w-0 flex-1">確定把 {group.rows.length} 項「{group.label}」都改成「{batchLabel}」？</span>
                      <button type="button" disabled={saving === `batch:${group.key}`} onClick={() => applyBatch(group, picked)} className="btn-primary min-h-10 px-3 text-xs disabled:opacity-50">{saving === `batch:${group.key}` ? '儲存中…' : '確定'}</button>
                      <button type="button" onClick={() => setBatch(null)} className="btn-outline min-h-10 bg-s1 px-3 text-xs">取消</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        }))}
    </section>
  );
}

/** 等車中：成交了但車還沒到。填預計到貨月份就好（不用確切日期）；車到了按一下，施工步驟才開始排日期。 */
function CarArrivalCard({ item, onSaveCase, onError }) {
  const awaiting = isAwaitingCar(item);
  const arrived = Boolean(item.carArrivedAt);
  const [month, setMonth] = useState(item.expectedCarMonth || '');
  const [arrivedDate, setArrivedDate] = useState(item.carArrivedAt || today());
  const [askArrive, setAskArrive] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save(next) {
    if (busy) return;
    setBusy(true);
    try { await onSaveCase({ ...next, updatedAt: new Date().toISOString() }); onError?.(''); }
    catch (cause) { onError?.(cause?.message || '儲存失敗，請再試一次'); }
    finally { setBusy(false); }
  }
  if (arrived) {
    return (
      <section className="card flex items-center justify-between gap-2 p-3">
        <p className="text-sm font-bold text-ink">🚚 車已到・{dayjs(item.carArrivedAt).format('M/D')}</p>
        <button type="button" disabled={busy} onClick={() => save({ ...item, carArrivedAt: '', awaitingCar: true })} className="min-h-10 px-2 text-[11px] font-semibold text-ink-3 underline underline-offset-2">按錯了，改回等車中</button>
      </section>
    );
  }
  if (!awaiting) {
    return (
      <section className="card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0"><p className="text-sm font-bold text-ink">🚚 車還沒到？</p><p className="text-[11px] text-ink-3">成交了但車要等一陣子：標成「等車中」，施工步驟與廠商追問先不催你。</p></div>
          <button type="button" disabled={busy} onClick={() => save(startAwaitingCar(item, month))} className="btn-outline min-h-11 shrink-0 px-3 text-xs font-bold">標成等車中</button>
        </div>
      </section>
    );
  }
  return (
    <section className="card space-y-2 border-copper/50 bg-copper/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-extrabold text-copper">🚚 等車中{item.expectedCarMonth ? `・預計 ${carMonthLabel(item.expectedCarMonth)}到` : ''}</p>
        <button type="button" disabled={busy} onClick={() => save(stopAwaitingCar(item))} className="min-h-10 px-2 text-[11px] font-semibold text-ink-3 underline underline-offset-2">不用等車了</button>
      </div>
      <label className="flex items-center gap-2 text-xs font-bold text-ink-2"><span className="shrink-0">預計到貨月份</span>
        <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); save({ ...item, awaitingCar: true, expectedCarMonth: e.target.value, carCheckDate: '' }); }} className="min-h-11 min-w-0 flex-1" /></label>
      {!askArrive
        ? <button type="button" disabled={busy} onClick={() => setAskArrive(true)} className="btn-primary min-h-12 w-full text-sm font-bold">🚚 車到了</button>
        : <div className="space-y-2 rounded-xl border border-bdr bg-s1 p-2.5">
          <label className="block text-xs font-bold text-ink-2">車是哪一天到的？<input type="date" value={arrivedDate} onChange={(e) => setArrivedDate(e.target.value)} className="mt-1 min-h-11 w-full text-sm font-normal" /></label>
          <p className="text-[11px] text-ink-3">按確定後，施工進度才開始排日期，今天頁也會開始提醒聯繫廠商與施工。</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setAskArrive(false)} className="btn-outline min-h-11">取消</button>
            <button type="button" disabled={busy || !arrivedDate} onClick={async () => { await save(markCarArrived(item, arrivedDate)); setAskArrive(false); }} className="btn-primary min-h-11 disabled:opacity-50">{busy ? '儲存中…' : '確定車到了'}</button>
          </div>
        </div>}
      <p className="text-[11px] leading-relaxed text-ink-3">到預計月份 1 號，今天頁會問你一次「車到了嗎？」，沒到可以選「延後」。車到之前不會自動催施工或廠商。</p>
    </section>
  );
}

function StockChecklist({ deal, quote, delivered = false, awaiting = false, addons = [], onSaveDeal, onError }) {
  const { suppliers = [] } = useApp();
  const [saving, setSaving] = useState(false);
  const items = deal.stockItems || [];
  async function updateStock(id, patch) {
    setSaving(true);
    try {
      await onSaveDeal({ ...deal, stockItems: items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item) });
      onError('');
    } catch (cause) { onError(cause?.message || '配件狀態儲存失敗'); }
    finally { setSaving(false); }
  }
  if (!deal.quoteId) return <section className="card border-warn/40 p-4"><h2 className="font-bold text-ink">成交配件核對</h2><p className="mt-2 text-sm text-warn">這是舊的手動成交，尚無指定成交報價。系統不會猜測配件，也不會納入中央點貨。</p></section>;
  const missing = items.filter((item) => !isSettledStock(item));
  const unlisted = delivered ? [] : unlistedStockItems(deal, quote, addons);
  const seqMap = vendorSequence(items);
  // 廠商施工先後順序：有編號的（橡膠墊→帆布…）依順序排在前面，其餘維持原順序
  const normalRows = items.filter((row) => !row.hidden && !row.info)
    .sort((a, b) => (seqMap.get(a.id) ?? (/貼紙|刻字/.test(a.name || '') ? 0 : 99)) - (seqMap.get(b.id) ?? (/貼紙|刻字/.test(b.name || '') ? 0 : 99)));
  const infoRows = items.filter((row) => row.info && !row.hidden);
  const hiddenRows = items.filter((row) => row.hidden);
  // 刪除：從核對表拿掉，並記下 id，之後報價再改也不會加回來、也不會再提示「還沒帶進核對」
  async function removeStock(id) {
    setSaving(true);
    try { await onSaveDeal({ ...deal, stockItems: items.filter((row) => row.id !== id), stockRemoved: [...new Set([...(deal.stockRemoved || []), id])] }); onError(''); }
    catch (cause) { onError(cause?.message || '刪除失敗'); }
    finally { setSaving(false); }
  }
  async function addUnlisted() {
    setSaving(true);
    try { const stamp = new Date().toISOString(); await onSaveDeal({ ...deal, stockItems: [...items, ...unlisted.map((it) => ({ ...it, updatedAt: stamp }))] }); onError(''); }
    catch (cause) { onError(cause?.message || '加入失敗'); }
    finally { setSaving(false); }
  }
  return <section id="case-stock" className="card p-4"><div className="flex items-center justify-between gap-2"><h2 className="font-bold text-ink">📦 成交配件逐項核對</h2><span className={`text-xs font-bold ${delivered ? 'text-ink-3' : missing.length ? 'text-copper' : 'text-ok'}`}>{delivered ? '已交車' : missing.length ? `尚缺 ${missing.length} 項` : '已全部核對'}</span></div><p className="mt-1 text-xs text-ink-3">只依「{quote?.model || deal.model || '成交報價'}」的成交版本建立。贈送實體配件也要核對。</p>{deal.pricingNeedsReview && <p className="mt-2 rounded-lg bg-warn/10 p-2 text-xs font-bold text-warn">舊成交已連結報價；原成交價與成本紀錄保留，請到後台核對利潤。</p>}{(quote?.requirements || quote?.note) && <div className="mt-2 rounded-lg border border-copper/30 bg-copper/10 p-3"><p className="text-xs font-bold text-copper">聯繫廠商前必看</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-ink-2">{[quote.requirements, quote.note].filter(Boolean).join('\n')}</p></div>}{unlisted.length > 0 && <div className="mt-3 rounded-lg border border-warn/50 bg-warn/15 p-3 text-xs text-black"><p className="font-bold">報價上有 {unlisted.length} 項還沒帶進核對：{unlisted.map((it) => it.name).join('、')}</p><button type="button" disabled={saving} onClick={addUnlisted} className="btn-primary mt-2 min-h-11 w-full text-sm font-bold disabled:opacity-50">帶進配件核對</button></div>}{items.length === 0 && unlisted.length === 0 && <p className="mt-3 rounded-lg bg-s2 p-3 text-xs text-ink-3">這張報價沒有可核對的配件。</p>}<div className="mt-3 space-y-2">{normalRows.map((row) => <StockRow delivered={delivered} awaiting={awaiting} seq={seqMap.get(row.id)} supplier={stockTrack(row) === 'vendor' ? supplierForItem(row, suppliers) : null} key={row.id} row={row} disabled={saving} onUpdate={(patch) => updateStock(row.id, patch)} onRemove={() => removeStock(row.id)} />)}</div>
    {infoRows.length > 0 && <div className="mt-4"><p className="text-xs font-bold text-ink-2">📎 報價上的其他項目與備註（費用、車價備註…）</p><p className="mt-0.5 text-[11px] text-ink-3">報價上的每一項都帶過來了，不算缺貨。你判斷：不用看的按「隱藏」，不要的按「刪除」，其實要備貨的按「改成要備貨」。</p><div className="mt-2 space-y-2">{infoRows.map((row) => <InfoStockRow key={row.id} row={row} disabled={saving} onUpdate={(patch) => updateStock(row.id, patch)} onRemove={() => removeStock(row.id)} />)}</div></div>}
    {hiddenRows.length > 0 && <details className="mt-3 rounded-xl border border-bdr bg-s2/50"><summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-bold text-ink-2">已隱藏 {hiddenRows.length} 項（點開可顯示或刪除）</summary><div className="space-y-2 border-t border-bdr p-2">{hiddenRows.map((row) => <InfoStockRow key={row.id} hidden row={row} disabled={saving} onUpdate={(patch) => updateStock(row.id, patch)} onRemove={() => removeStock(row.id)} />)}</div></details>}
  </section>;
}

/** 報價上帶過來的資訊（費用、車價備註）與已隱藏的項目：只有名稱、金額、備註，由使用者自己判斷。 */
function InfoStockRow({ row, hidden = false, disabled, onUpdate, onRemove }) {
  return <div className={`rounded-xl border border-bdr p-3 ${hidden ? 'bg-s1 opacity-80' : 'bg-s2'}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink">{row.name}{row.specification ? `・${row.specification}` : ''}</p>
        {row.quotePrice > 0 && <p className="text-[11px] text-ink-3">報價 NT$ {formatMoney(row.quotePrice)}</p>}
        {row.note && <p className="mt-1 whitespace-pre-wrap text-xs text-ink-2">備註：{row.note}</p>}
      </div>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {hidden
        ? <button type="button" disabled={disabled} onClick={() => onUpdate({ hidden: false })} aria-label={`顯示${row.name}`} className="btn-outline min-h-10 px-3 text-xs font-bold">顯示</button>
        : <>
          {row.info && <button type="button" disabled={disabled} onClick={() => onUpdate({ info: false, status: 'todo' })} aria-label={`${row.name}改成要備貨`} className="btn-outline min-h-10 px-3 text-xs font-bold">改成要備貨</button>}
          <button type="button" disabled={disabled} onClick={() => onUpdate({ hidden: true })} aria-label={`隱藏${row.name}`} className="btn-outline min-h-10 px-3 text-xs font-bold">🙈 隱藏</button>
        </>}
      <ConfirmDeleteButton onConfirm={onRemove} label="🗑 刪除" ariaLabel={`刪除${row.name}`} className="ml-auto min-h-10 px-3 text-xs font-bold" />
    </div>
  </div>;
}

function StockRow({ row, disabled, delivered = false, awaiting = false, seq = null, supplier = null, onUpdate, onRemove }) {
  const [note, setNote] = useState(row.note || '');
  const status = stockStatus(row);
  const track = stockTrack(row);
  const next = nextStatus(row);
  const settled = isSettledStock(row);
  const follow = awaiting ? '' : addDays(today(), 3); // 等車中不自動排再追日
  return <div className="rounded-xl border border-bdr bg-s2 p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="font-bold text-ink"><span className={`badge mr-1.5 ${track === 'vendor' ? 'bg-copper/15 text-copper' : 'bg-teal/15 text-teal'}`}>{TRACK_LABELS[track]}</span>{row.name}{row.specification ? `・${row.specification}` : ''} × {row.quantity || 1}</p>
        {(seq || supplier) && <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-2">{seq ? <span className="badge border border-copper/50 bg-copper/10 font-bold text-copper">第 {seq} 步</span> : null}{supplier ? <span>🤝 {supplier.name}{supplier.contact ? `・${supplier.contact}` : ''}{supplier.phone ? <a href={`tel:${supplier.phone}`} className="ml-1 font-bold text-accent" aria-label={`撥打${supplier.name}`}>📞</a> : null}</span> : null}</p>}
        {row.fromBundle && <p className="text-[11px] text-ink-3">來自套件：{row.fromBundle}</p>}
        {row.gift && <p className="text-[11px] text-copper">贈送配件，仍需備品</p>}
        {row.note && <p className="mt-1 whitespace-pre-wrap text-xs text-ink-2">備註：{row.note}</p>}
      </div>
      {next
        ? <button type="button" disabled={disabled} onClick={() => onUpdate(statusPatch(row, next[0], follow))} className={`min-h-11 shrink-0 rounded-lg border px-3 text-xs font-bold ${settled ? 'border-ok bg-ok/15 text-ok' : 'border-copper bg-copper/10 text-copper'}`}>→ {next[1]}</button>
        : <span className="flex min-h-11 shrink-0 items-center rounded-lg bg-ok/10 px-3 text-xs font-bold text-ok">✓ {statusLabel(row)}</span>}
    </div>
    <div className="mt-2 grid grid-cols-1 gap-2">
      <StatusChips row={row} disabled={disabled} label={`${row.name}備品狀態`} onPick={(id) => onUpdate(statusPatch(row, id, follow))} />
      {status === 'inquiry'
        ? <label className="block text-[11px] text-ink-3">再追日期<input type="date" value={row.followUpDate || ''} onChange={(e) => onUpdate({ followUpDate: e.target.value })} aria-label={`${row.name}再追日期`} className={`min-h-11 w-full text-sm ${row.followUpDate || delivered ? '' : 'border-danger'}`} disabled={disabled} /></label>
        : <span />}
    </div>
    {status === 'inquiry' && !row.followUpDate && !delivered && !awaiting && <p className="mt-1 text-[11px] font-bold text-danger">{statusLabel(row)}，請設定再追日期</p>}
    <details className="mt-1 text-xs text-ink-2"><summary className="min-h-10 cursor-pointer py-2">修改類別、數量或備註</summary>
      <div className="space-y-2 pt-1">
        <label className="block">這項屬於
          <ChipSelect value={track} aria-label={`${row.name}類別`} onChange={(e) => { const sw = switchTrack(row, e.target.value); onUpdate({ track: sw.track, status: sw.status }); }} className="mt-1 min-h-11 w-full" disabled={disabled}>
            <option value="vendor">外包（帆布、箱體、尾門、烤漆…）</option>
            <option value="inhouse">改裝部配件</option>
          </ChipSelect>
        </label>
        <label className="block">數量<input type="number" aria-label={`${row.name}數量`} min="1" value={row.quantity || 1} onChange={(e) => onUpdate({ quantity: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 min-h-11 w-full" disabled={disabled} /></label>
        <label className="block">廠商／客戶要求<input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note !== (row.note || '')) onUpdate({ note }); }} placeholder="規格、廠商或客戶特殊要求" aria-label={`${row.name}備註`} className="mt-1 min-h-11 w-full" /></label>
        <div className="flex items-center gap-2 pt-1">
          <button type="button" disabled={disabled} onClick={() => onUpdate({ hidden: true })} aria-label={`隱藏${row.name}`} className="btn-outline min-h-11 flex-1 text-xs font-bold">🙈 隱藏（不算缺貨、不顯示）</button>
          <ConfirmDeleteButton onConfirm={onRemove} label="🗑 刪除" ariaLabel={`刪除${row.name}`} className="min-h-11 shrink-0 px-3 text-xs font-bold" />
        </div>
      </div>
    </details>
  </div>;
}

function NewCaseModal({ clients, cats, stages, initialClientId, onClose, onSaveCase, onSaveClient, onSaveWorkItem, onSaveActivity, onCreated }) {
  const [clientMode, setClientMode] = useState(clients.length ? 'existing' : 'new');
  const [clientId, setClientId] = useState(initialClientId || '');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState('purchase');
  const [title, setTitle] = useState('');
  const [nextTitle, setNextTitle] = useState('確認客戶需求');
  const [startQuote, setStartQuote] = useState(true);
  const [followUpMode, setFollowUpMode] = useState('relative');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpAmount, setFollowUpAmount] = useState('3');
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
    const createdAt = new Date().toISOString();
    const item = await onSaveCase(advanceCasePipeline({
      id, clientId: client.id, clientName: client.name, type, status: 'active',
      title: title.trim() || (type === 'purchase' ? '買車案件' : '改裝案件'), source: 'manual', quoteIds: [], dealId: null,
      lastContactAt: null, createdAt, updatedAt: createdAt,
      nextFollowUpDate: nextFollowUpDate || '', followUpPlanMode: nextFollowUpDate ? followUpMode : null,
      followUpNote: nextTitle.trim(),
      followUpPlanBaseDate: nextFollowUpDate && followUpMode === 'relative' ? today() : null,
      followUpPlanAmount: nextFollowUpDate && followUpMode === 'relative' ? Number(followUpAmount) : null,
      followUpPlanUnit: nextFollowUpDate && followUpMode === 'relative' ? followUpUnit : null,
    }, 'new', createdAt));
    // 建案時寫的「下一步」存在案件上，只會在「今天」出現一張卡（不再另外建重複待辦）。
    await onSaveActivity({ id: generateId('activity'), caseId: id, clientId: client.id, type: 'created', text: `建立${CASE_TYPE_LABEL[type]}案件`, date: today() });
    onCreated(item.id, { quote: startQuote, item });
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
            <label className="section-title block px-0">客戶</label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button type="button" onClick={() => setClientMode('existing')} className={`min-h-12 rounded-xl border ${clientMode === 'existing' ? 'border-teal bg-teal/12 text-teal' : 'border-bdr'}`}>選既有客戶</button>
              <button type="button" onClick={() => setClientMode('new')} className={`min-h-12 rounded-xl border ${clientMode === 'new' ? 'border-teal bg-teal/12 text-teal' : 'border-bdr'}`}>建立新客戶</button>
            </div>
            {clientMode === 'existing' ? <div className="mt-3"><ClientPicker clients={clients} value={clientId} onChange={setClientId} placeholder="輸入姓名或電話搜尋客戶…" /></div>
              : <div className="grid grid-cols-1 gap-2 mt-3"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="客戶姓名或公司名稱（必填）" className="min-h-12" /><input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" inputMode="tel" placeholder="電話（選填）" className="min-h-12" /></div>}
          </section>
          <section>
            <label className="section-title block px-0">買車還是改車</label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[['purchase', '🚛 購車'], ['modification', '🛠️ 改車']].map(([key, label]) => <button key={key} type="button" onClick={() => setType(key)} className={`min-h-16 rounded-xl border text-base font-bold ${type === key ? (key === 'purchase' ? 'border-danger bg-danger text-white' : 'border-warn bg-warn text-black') : 'border-bdr'}`}>{label}</button>)}
            </div>
          </section>
          <label className="flex min-h-12 items-center gap-3 rounded-xl border border-bdr bg-s2 px-3 text-sm font-semibold text-ink"><input type="checkbox" checked={startQuote} onChange={(event) => setStartQuote(event.target.checked)} className="h-6 w-6" />建好後直接做報價</label>
          <p className="text-xs text-ink-3">其他都不用填：系統會排 {nextFollowUpDate ? dayjs(nextFollowUpDate).format('M/D') : '（未排）'} 提醒你追蹤，案件名稱做完報價會自動帶車型。</p>
          <details className="rounded-xl border border-bdr">
            <summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-ink-2">更多選項（案件名稱、要確認的事、追蹤日）</summary>
            <div className="space-y-2 border-t border-bdr p-3">
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={type === 'purchase' ? '案件名稱，例：K2500 雙廂購車' : '案件名稱，例：尾門＋帆布改裝'} className="w-full min-h-12" />
              <input value={nextTitle} onChange={(event) => setNextTitle(event.target.value)} placeholder="下一步要做什麼" className="w-full min-h-12" />
              <p className="pt-2 text-xs font-bold text-ink-2">下次追蹤日（不想排就把數量清空）</p>
              <FollowUpTargetChooser mode={followUpMode} onModeChange={setFollowUpMode} date={followUpDate} onDateChange={setFollowUpDate} amount={followUpAmount} onAmountChange={setFollowUpAmount} unit={followUpUnit} onUnitChange={setFollowUpUnit} targetDate={nextFollowUpDate} />
            </div>
          </details>
          {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary min-h-14 w-full text-base font-bold disabled:opacity-50">{saving ? '儲存中…' : startQuote ? '建立並做報價' : '建立案件'}</button>
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
          <label className="block text-[11px] font-medium text-ink-3">單位<ChipSelect value={unit} onChange={(event) => onUnitChange(event.target.value)} className="mt-1 min-h-12 w-full"><option value="days">天後</option><option value="weeks">週後</option></ChipSelect></label>
        </div>
      )}
      {targetDate && <div className="rounded-xl border border-ok/35 bg-ok/10 px-3 py-2 text-sm font-bold text-ok">下次追蹤：{dayjs(targetDate).format('YYYY/MM/DD')}</div>}
    </div>
  );
}

function CasePipeline({ item, currentId, deals, quotes, onChangeStage, onOpenQuote }) {
  const [showStages, setShowStages] = useState(false);
  const [confirmStageId, setConfirmStageId] = useState(null);
  const [saving, setSaving] = useState(false);
  const currentIndex = Math.max(0, CASE_PIPELINE_STAGES.findIndex((stage) => stage.id === currentId));
  const currentDays = getCasePipelineElapsedDays(item, { deals, quotes });
  const totalDays = getCaseTotalElapsedDays(item, { deals, quotes });
  const currentStage = CASE_PIPELINE_STAGES[currentIndex];
  const nextStage = CASE_PIPELINE_STAGES[currentIndex + 1] || null;
  const hasDeal = deals.some((row) => row.id === item.dealId || row.caseId === item.id);
  const confirmStage = CASE_PIPELINE_STAGES.find((stage) => stage.id === confirmStageId);
  // 已成交但還沒指定是哪一張報價成交（案件有報價時）→ 先指定，才能往交車走
  const needsWinner = currentId === 'won' && (item.quoteIds || []).length > 0
    && !deals.some((row) => (row.id === item.dealId || row.caseId === item.id) && row.quoteId);

  async function applyStage() {
    if (!confirmStage || saving) return;
    setSaving(true);
    try {
      await onChangeStage?.(confirmStage.id);
      setConfirmStageId(null);
      setShowStages(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-4" aria-label="案件進度">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold text-copper">目前階段</p>
          <h2 className="mt-1 text-lg font-bold text-ink">{currentIndex + 1}. {currentStage?.label}</h2>
          <p className="mt-1 text-xs text-ink-3">這階段第 {currentDays} 天・案件總計 {totalDays} 天</p>
        </div>
        <span className="rounded-full bg-copper/12 px-3 py-1 text-xs font-bold text-copper">{currentIndex + 1} / {CASE_PIPELINE_STAGES.length}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-s3"><div className="h-full rounded-full bg-copper" style={{ width: `${((currentIndex + 1) / CASE_PIPELINE_STAGES.length) * 100}%` }} /></div>
      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
        {nextStage
          ? <button type="button" onClick={() => needsWinner ? document.getElementById('case-quotes')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : nextStage.id === 'won' && !hasDeal ? onOpenQuote?.(item, (item.quoteIds || [])[0] || null) : setConfirmStageId(nextStage.id)} className="btn-primary min-h-12">{needsWinner ? '先指定是哪張報價成交 ↓' : nextStage.id === 'won' && !hasDeal ? '先選擇成交報價 →' : `下一階段：${nextStage.label} →`}</button>
          : <div className="flex min-h-12 items-center justify-center rounded-xl bg-ok/10 text-sm font-bold text-ok">✓ 案件已完成</div>}
        <button type="button" onClick={() => setShowStages((value) => !value)} className="btn-outline min-h-12 px-3">{showStages ? '收起' : '調整'}</button>
      </div>
      {showStages && <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl bg-s2 p-2">{CASE_PIPELINE_STAGES.map((stage, index) => <button key={stage.id} type="button" disabled={stage.id === currentId || (index >= 2 && !hasDeal)} onClick={() => setConfirmStageId(stage.id)} className={`min-h-11 rounded-lg border px-3 text-left text-sm font-bold ${stage.id === currentId ? 'border-copper bg-copper/12 text-copper' : 'border-bdr bg-s1 text-ink-2'}`}>{index + 1}. {stage.label}{stage.id === currentId ? '（目前）' : index >= 2 && !hasDeal ? '（先確認成交報價）' : ''}</button>)}</div>}
      {confirmStage && <div role="alert" className="mt-3 rounded-xl border border-copper/40 bg-copper/5 p-3"><p className="text-sm font-bold text-ink">確定切換到「{confirmStage.label}」？</p><p className="mt-1 text-xs text-ink-3">切換後會從第 1 天重新計算這個階段，案件總天數仍會保留。</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={saving} onClick={() => setConfirmStageId(null)} className="btn-outline min-h-11">先不要</button><button type="button" disabled={saving} onClick={applyStage} className="btn-primary min-h-11">{saving ? '儲存中…' : '確認切換'}</button></div></div>}
    </section>
  );
}

function CaseEditSheet({ item, currentPipeline = 'new', workItems = [], hasLinkedDeal = false, onClose, onDeleted, onSaveCase, onDeleteCase, onSaveWorkItem, onSaveActivity }) {
  const [title, setTitle] = useState(item.title || '');
  const [type, setType] = useState(item.type || 'purchase');
  const pipelineStage = currentPipeline;
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
    try {
    const savedAt = new Date().toISOString();
    await onSaveCase({
      ...advanceCasePipeline(item, pipelineStage, savedAt), title: title.trim(), type, status: pipelineStage === 'completed' ? 'completed' : 'active',
      nextFollowUpDate: pipelineStage === 'completed' ? '' : nextFollowUpDate,
      followUpPlanMode: pipelineStage === 'completed' ? null : followUpMode,
      followUpPlanBaseDate: pipelineStage !== 'completed' && followUpMode === 'relative' ? followUpBaseDate : null,
      followUpPlanAmount: pipelineStage !== 'completed' && followUpMode === 'relative' ? Number(followUpAmount) : null,
      followUpPlanUnit: pipelineStage !== 'completed' && followUpMode === 'relative' ? followUpUnit : null,
      updatedAt: savedAt,
    });
    // 案件自己的追蹤日由 case.nextFollowUpDate 推導成工作佇列項目（沒有對應的獨立待辦列），
    // 所以不再順手改任何一筆手動待辦的到期日。
    await onSaveActivity({
      id: generateId('activity'), caseId: item.id, clientId: item.clientId, clientName: item.clientName,
      type: 'case', text: `更新案件：${title.trim()}・${CASE_PIPELINE_STAGES.find((stage) => stage.id === pipelineStage)?.label}`, date: today(),
    });
    onClose();
    } catch (cause) {
      setError(cause?.message || '案件儲存失敗，請再試一次。');
    } finally {
      setSaving(false);
    }
  }

  async function removeCase() {
    if (deleting) return;
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
          <section><p className="text-xs font-bold text-ink-2">案件種類</p><div className="mt-2 grid grid-cols-2 gap-2">{[['purchase', '🚛 購車案件'], ['modification', '🛠️ 改車案件']].map(([key, label]) => <button key={key} type="button" onClick={() => setType(key)} className={`min-h-12 rounded-xl border font-bold ${type === key ? (key === 'purchase' ? 'border-danger bg-danger text-white' : 'border-warn bg-warn text-black') : 'border-bdr text-ink-2'}`}>{label}</button>)}</div></section>
          {pipelineStage !== 'completed' && <section><p className="text-xs font-bold text-ink-2">下次追蹤日</p><p className="mt-1 text-xs text-ink-3">只會更新這一筆案件。</p><FollowUpTargetChooser mode={followUpMode} onModeChange={(nextMode) => { if (nextMode === 'relative' && followUpMode !== 'relative') setFollowUpBaseDate(today()); setFollowUpMode(nextMode); }} date={followUpDate} onDateChange={setFollowUpDate} amount={followUpAmount} onAmountChange={setFollowUpAmount} unit={followUpUnit} onUnitChange={setFollowUpUnit} targetDate={nextFollowUpDate} /></section>}
          {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</p>}
          <div className="grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="btn-outline min-h-12">取消</button><button type="submit" disabled={saving} className="btn-primary min-h-12">{saving ? '儲存中…' : '確認儲存案件'}</button></div>
          <section className="rounded-2xl border border-danger/30 bg-danger/5 p-3">
            <p className="text-sm font-bold text-danger">刪除廢棄案件</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-3">案件會移到「已刪除」；客戶、報價、工作與紀錄都會保留，可隨時恢復。</p>
            {hasLinkedDeal && <p className="mt-3 rounded-xl bg-s2 px-3 py-2 text-xs font-semibold text-ink-2">此案件含成交或施工資料；移到「已刪除」後資料仍會保留，恢復案件即可重新顯示。</p>}
            {!confirmDelete ? (
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

function CaseDetail({ item, phone = '', workItems, tasks, caseQueue, activities, deals, quotes, onClose, onSaveCase, onSaveDeal, onDeleteCase, onSaveWorkItem, onSaveActivity, onSaveTask, onUpdateClient, onOpenClient, onOpenQuote, onOpenOperations }) {
  const { quotePresets } = useApp();
  const [newTitle, setNewTitle] = useState('');
  const [addingWork, setAddingWork] = useState(false);
  const [due, setDue] = useState('');
  const [section, setSection] = useState('overview');
  const [stockError, setStockError] = useState('');
  const [desiredDate, setDesiredDate] = useState(item.desiredDeliveryDate || '');
  const [urgent, setUrgent] = useState(Boolean(item.urgent));
  const [urgentReason, setUrgentReason] = useState(item.urgentReason || '');
  const [showEdit, setShowEdit] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contactResult, setContactResult] = useState('');
  const [contactNextDate, setContactNextDate] = useState(item.nextFollowUpDate || '');
  const [contactError, setContactError] = useState('');
  const [contactSaving, setContactSaving] = useState(false);
  const linkedDeal = findDealForCase(deals, item);
  const { confirmQuoteDeal, archiveQuoteDraft } = useApp();
  const [deleteQuote, setDeleteQuote] = useState(null);
  const [showPhotos, setShowPhotos] = useState(false);
  const [pickQuote, setPickQuote] = useState(false); // 有多張報價時，先選要開哪一張
  const [showClose, setShowClose] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  async function closeCase(reason) {
    if (closeBusy) return;
    setCloseBusy(true);
    const stamp = new Date().toISOString();
    try {
      await onSaveCase({ ...item, status: 'closed', closedReason: reason, closedAt: stamp, nextFollowUpDate: '', updatedAt: stamp });
      await onSaveActivity({ id: generateId('activity'), caseId: item.id, clientId: item.clientId, clientName: item.clientName, type: 'work', text: `結案不追蹤：${reason}`, date: today() });
      setShowClose(false);
    } finally { setCloseBusy(false); }
  }
  async function reopenCase() {
    if (closeBusy) return;
    setCloseBusy(true);
    const stamp = new Date().toISOString();
    try {
      const { closedReason, closedAt, ...rest } = item;
      await onSaveCase({ ...rest, status: 'active', nextFollowUpDate: addDays(today(), 3), updatedAt: stamp });
      await onSaveActivity({ id: generateId('activity'), caseId: item.id, clientId: item.clientId, clientName: item.clientName, type: 'work', text: '重新追蹤', date: today() });
    } finally { setCloseBusy(false); }
  }
  const [pickWinnerId, setPickWinnerId] = useState(null);
  const [winnerBusy, setWinnerBusy] = useState(false);
  const [winnerError, setWinnerError] = useState('');
  async function pickWinner(quoteId) {
    if (winnerBusy) return;
    setWinnerBusy(true); setWinnerError('');
    try { await confirmQuoteDeal(quoteId); setPickWinnerId(null); }
    catch (cause) { setWinnerError(cause?.message || '指定成交報價失敗，請再試一次。'); }
    finally { setWinnerBusy(false); }
  }
  const linkedQuotes = quotes.filter((row) => !row.archivedAt && ((item.quoteIds || []).includes(row.id) || row.caseId === item.id));
  const pipelineStage = getCasePipelineStage(item, { deals, quotes });
  const pipelineStageId = getCasePipelineStageId(item, { deals, quotes });
  const caseWork = workItems.filter((row) => row.caseId === item.id);
  // 施工工作由下方的案件施工卡統一處理，避免在「下一步」出現第二套完成入口。
  const pending = caseQueue.filter((row) => row.sourceType !== 'delivery' && row.sourceType !== 'car-arrival');
  const actionablePending = pending.filter((row) => row.state !== 'waiting');
  const waitingPending = pending.filter((row) => row.state === 'waiting');
  const completed = caseWork.filter((row) => row.state === 'done');
  const timeline = activities.filter((row) => row.caseId === item.id).sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  const workflow = normalizeDeliveryWorkflow(linkedDeal || {});
  const followUpTiming = item.nextFollowUpDate
    ? dayjs(item.nextFollowUpDate).startOf('day').diff(dayjs().startOf('day'), 'day')
    : null;

  // 交車日／急件改了就直接存（不用再按儲存）
  async function saveDeliveryTarget(patch) {
    try { await onSaveCase({ ...item, desiredDeliveryDate: desiredDate, urgent, urgentReason: urgent ? urgentReason.trim() : '', ...patch }); setStockError(''); }
    catch (cause) { setStockError(cause?.message || '儲存失敗'); }
  }

  async function recordContact(event, preset = null) {
    event?.preventDefault?.();
    if (contactSaving) return;
    const resultText = (preset?.result ?? contactResult).trim();
    const nextDate = preset ? addDays(today(), preset.days) : contactNextDate;
    if (!resultText) { setContactError('請填寫這次聯繫結果。'); return; }
    if (pipelineStageId !== 'completed' && !nextDate) { setContactError('請設定這筆案件的下次追蹤日。'); return; }
    setContactSaving(true);
    setContactError('');
    const timestamp = new Date().toISOString();
    try {
      await onSaveCase(applyCaseContact(item, pipelineStageId, { nextDate, timestamp }));
      await onSaveActivity({ id: generateId('activity'), caseId: item.id, clientId: item.clientId, clientName: item.clientName, type: 'contact', text: `聯繫：${resultText}`, date: timestamp });
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
    if (!newTitle.trim() || addingWork) return;
    setAddingWork(true);
    try {
      await onSaveWorkItem({ id: generateId('work'), caseId: item.id, clientId: item.clientId, clientName: item.clientName, title: newTitle.trim(), due, state: 'todo' });
      await onSaveActivity({ id: generateId('activity'), caseId: item.id, clientId: item.clientId, type: 'work', text: `新增工作：${newTitle.trim()}`, date: today() });
      setNewTitle('');
    } catch (cause) {
      window.alert(cause?.message || '新增工作失敗。');
    } finally {
      setAddingWork(false);
    }
  }

  function goToSop() {
    setSection('overview');
    setTimeout(() => document.getElementById('case-sop')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  function goToStock() {
    setSection('overview');
    setTimeout(() => {
      const box = document.getElementById('case-stock');
      box?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      box?.querySelector('details')?.setAttribute('open', '');
    }, 60);
  }

  async function finishWork(row) {
    if (row.sourceType === 'delivery') {
      goToSop();
      return;
    }
    if (row.sourceType === 'case-follow-up') {
      setContactNextDate(addDays(today(), 3));
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

  async function changePipelineStage(stageId) {
    if (stageId === pipelineStageId) return;
    const timestamp = new Date().toISOString();
    const stage = CASE_PIPELINE_STAGES.find((row) => row.id === stageId);
    await onSaveCase({
      ...advanceCasePipeline(item, stageId, timestamp),
      status: stageId === 'completed' ? 'completed' : 'active',
      nextFollowUpDate: stageId === 'completed' ? '' : item.nextFollowUpDate,
      updatedAt: timestamp,
    });
    await onSaveActivity({
      id: generateId('activity'), caseId: item.id, clientId: item.clientId,
      type: 'case', text: `案件階段切換：${stage?.label || stageId}`, date: timestamp,
    });
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
          {item.status === 'closed'
            ? <section className="card border-ink-3/40 bg-s2 p-4"><p className="font-bold text-ink">⏹ 已結案・不追蹤{item.closedReason ? `（${item.closedReason}）` : ''}</p><p className="mt-1 text-xs text-ink-3">這筆案件不會再出現在「今天」。客戶又有興趣時，按下面重新追蹤。</p><button type="button" disabled={closeBusy} onClick={reopenCase} className="btn-primary mt-3 min-h-11 w-full disabled:opacity-50">{closeBusy ? '處理中…' : '重新追蹤（3 天後再聯繫）'}</button></section>
            : <section className={`card p-4 ${item.nextFollowUpDate ? 'border-copper/35' : item.status === 'completed' ? '' : 'border-gold/55 bg-gold/5'}`}>
              <div className="grid grid-cols-2 gap-3"><div><p className="text-[11px] font-bold text-teal">最近聯繫</p><p className="mt-1 text-base font-bold text-ink">{item.lastContactAt ? dayjs(item.lastContactAt).format('YYYY/MM/DD') : '尚未聯繫'}</p></div><div><p className="text-[11px] font-bold text-copper">下次追蹤</p><p className="mt-1 text-base font-bold text-ink">{item.nextFollowUpDate ? dayjs(item.nextFollowUpDate).format('YYYY/MM/DD') : item.status === 'completed' ? '案件已完成' : '尚未設定'}</p>{item.nextFollowUpDate && <p className={`mt-1 text-xs ${followUpTiming < 0 ? 'font-bold text-danger' : 'text-ink-3'}`}>{followUpTiming < 0 ? `已逾期 ${Math.abs(followUpTiming)} 天` : followUpTiming === 0 ? '今天需要追蹤' : `${followUpTiming} 天後追蹤`}</p>}</div></div>
              <div className="mt-4 flex gap-2">{phone && <a href={`tel:${phone}`} onClick={() => { setContactNextDate(addDays(today(), 3)); setShowContact(true); }} aria-label={`撥打 ${phone}`} className="btn-outline min-h-12 shrink-0 px-4 font-bold">📞 撥號</a>}<button type="button" onClick={() => { setContactNextDate(addDays(today(), 3)); setShowContact(true); }} className="btn-primary min-h-12 flex-1">✍️ 記錄聯繫</button></div>
            </section>}
          <section className="grid grid-cols-3 gap-2">
            <button type="button" disabled={!item.clientId} onClick={() => item.clientId && onOpenClient?.(item.clientId)} className="card min-h-16 px-2 py-3 text-xs font-bold text-accent disabled:opacity-40">👤 客戶資料</button>
            <button type="button" onClick={() => (linkedQuotes.length > 1 ? setPickQuote(true) : onOpenQuote?.(item, linkedQuotes[0]?.id || null))} className="card min-h-16 px-2 py-3 text-xs font-bold text-gold">🧾 {linkedQuotes.length ? `報價 ${linkedQuotes.length}` : '建立報價'}</button>
            <button type="button" disabled={!linkedDeal} onClick={goToSop} className="card min-h-16 px-2 py-3 text-xs font-bold text-copper disabled:opacity-40">🚚 {linkedDeal ? '施工進度' : '尚未成交'}</button>
          </section>
          <button type="button" onClick={() => setShowSheet(true)} className="card flex min-h-14 w-full items-center justify-between px-4 py-3 text-sm font-bold text-ink">
            <span>📋 卡旺選配表</span>
            <span className="text-xs font-semibold text-ink-3">{sheetHasContent(normalizeSheet(item.optionSheet)) ? '已填寫・點開查看' : '照紙本格式，自己勾選'}</span>
          </button>
          {pickQuote && (
            <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 md:items-center" onClick={() => setPickQuote(false)}>
              <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-bdr bg-s1 p-4 shadow-panel" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-bold text-ink">要開哪一張報價？</h2>
                  <button type="button" onClick={() => setPickQuote(false)} className="btn-outline min-h-11 px-3">關閉</button>
                </div>
                <p className="mt-1 text-xs text-ink-3">這個案件有 {linkedQuotes.length} 張報價，點一張來看或修改。</p>
                <div className="mt-3 space-y-2">
                  {[...linkedQuotes].sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || ''))).map((quote) => {
                    const won = linkedDeal?.quoteId === quote.id;
                    return (
                      <button key={quote.id} type="button" onClick={() => { setPickQuote(false); onOpenQuote?.(item, quote.id); }}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl border-2 p-3 text-left ${won ? 'border-danger/50 bg-danger/10' : 'border-bdr bg-s2'}`}>
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-ink">{won ? '✓ 成交報價' : linkedDeal?.quoteId ? '未採用報價' : '報價'}・{quote.planName || quote.model || '未填車型'}</span>
                          <span className="block text-xs text-ink-3">{quote.planName ? `${quote.model || '未填車型'}・` : ''}{quote.date || ''}{quote.note ? `・${quote.note}` : ''}</span>
                        </span>
                        <strong className="shrink-0 text-gold">NT$ {formatMoney(quote.total)} ›</strong>
                      </button>
                    );
                  })}
                </div>
                <button type="button" onClick={() => { setPickQuote(false); onOpenQuote?.(item, null); }} className="btn-outline mt-3 min-h-12 w-full text-sm font-bold">＋ 新增一張報價</button>
              </div>
            </div>
          )}
          {deleteQuote && <MasterPinDialog title="輸入密碼才能刪除" danger confirmLabel="確認刪除"
            description={`這張報價會放進回收筒（可以恢復）。${linkedDeal?.quoteId === deleteQuote.id ? '它是已成交的報價：成交紀錄、金額與配件核對表都保留，只是報價單從清單移到回收筒。' : ''}`}
            onCancel={() => setDeleteQuote(null)}
            onVerified={async () => { await archiveQuoteDraft(deleteQuote.id); setDeleteQuote(null); }} />}
          {item.clientId && (showPhotos
            ? <div className="space-y-2"><ClientPhotos clientId={item.clientId} caseId={item.id} /><button type="button" onClick={() => setShowPhotos(false)} className="btn-ghost min-h-10 w-full text-xs">收起照片與檔案</button></div>
            : <button type="button" onClick={() => setShowPhotos(true)} className="card flex min-h-14 w-full items-center justify-between px-4 py-3 text-sm font-bold text-ink">
              <span>📷 案件照片與檔案</span><span className="text-xs font-semibold text-ink-3">照片、PDF、合約・點開</span>
            </button>)}
          {showSheet && <OptionSheet item={item} deal={linkedDeal} quotes={linkedQuotes} onClose={() => setShowSheet(false)} onSave={(optionSheet) => onSaveCase({ ...item, optionSheet })} />}

          <nav className="grid grid-cols-4 gap-1 rounded-xl border border-bdr bg-s1 p-1 sticky top-[3.9rem] z-10">
            {[['overview', '總覽'], ['work', '工作'], ['quotes', '報價'], ['history', '紀錄']].map(([key, label]) => <button key={key} type="button" onClick={() => setSection(key)} className={`min-h-10 rounded-lg text-xs font-bold ${section === key ? 'bg-teal text-on-accent' : 'text-ink-2'}`}>{label}</button>)}
          </nav>

          {(section === 'overview' || section === 'work') && linkedDeal && item.status !== 'completed' && <CarArrivalCard item={item} onSaveCase={onSaveCase} onError={setStockError} />}

          {section === 'overview' && linkedDeal && item.status !== 'completed' && <section className="card p-3 space-y-2">
            <div className="flex items-center gap-3">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-bold text-ink-2"><span className="shrink-0">交車日</span><input type="date" value={desiredDate} onChange={(e) => { setDesiredDate(e.target.value); saveDeliveryTarget({ desiredDeliveryDate: e.target.value }); }} className="min-h-11 min-w-0 flex-1" /></label>
              <label className="flex shrink-0 items-center gap-2 text-sm font-semibold text-ink-2"><input type="checkbox" checked={urgent} onChange={(e) => { setUrgent(e.target.checked); saveDeliveryTarget({ urgent: e.target.checked, urgentReason: e.target.checked ? urgentReason.trim() : '' }); }} className="h-6 w-6" />急件</label>
            </div>
            {urgent && <input value={urgentReason} onChange={(e) => setUrgentReason(e.target.value)} onBlur={() => saveDeliveryTarget({ urgentReason: urgentReason.trim() })} placeholder="急件原因（選填）" className="w-full min-h-11" />}
            <p className="text-[11px] text-ink-3">改了就自動存。交車前 7 天還缺配件，會在「今天」提醒你。</p>
          </section>}

          {(section === 'overview' || section === 'work') && linkedDeal && <CaseDeliveryChecklist key={linkedDeal.id} deal={linkedDeal} caseItem={item} onGoStock={goToStock} />}

          {(section === 'overview' || section === 'work') && linkedDeal && <StockChecklist delivered={item.status === 'completed'} awaiting={isAwaitingCar(item)} addons={quotePresets?.addons || []} deal={linkedDeal} quote={linkedDeal.quoteSnapshot || linkedQuotes.find((quote) => quote.id === linkedDeal.quoteId)} onSaveDeal={onSaveDeal} onError={setStockError} />}
          {stockError && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{stockError}</p>}

          {(section === 'work' || (section === 'overview' && pending.length > 0)) && <section className="card p-4">
            <h2 className="font-bold text-ink">{workflow.length ? '其他待辦' : '下一步'}</h2>
            {pending.length === 0 ? <p className="text-sm text-ink-3 mt-3">尚未安排工作。</p> : <div className="space-y-2 mt-3">{actionablePending.map((row) => <div key={row.id} className="rounded-xl border border-bdr bg-s2 p-3 flex items-center gap-3"><button type="button" onClick={() => finishWork(row)} className={`w-11 h-11 rounded-full border-2 font-bold shrink-0 ${row.sourceType === 'delivery' ? 'border-copper text-copper' : 'border-ok text-ok'}`} aria-label={row.sourceType === 'delivery' ? `前往施工進度處理 ${row.title}` : `完成 ${row.title}`}>{row.sourceType === 'delivery' ? '→' : '✓'}</button><div className="min-w-0 flex-1"><p className="font-medium text-ink">{row.title}</p><p className="text-xs text-ink-3 mt-0.5">{row.sourceType === 'delivery' ? '前往施工進度確認後再變更狀態' : (row.due ? dayjs(row.due).format('YYYY/MM/DD') : '未排日期')}</p></div></div>)}{actionablePending.length === 0 && <p className="rounded-xl bg-s2 p-3 text-sm text-ink-3">目前工作都在等待前置階段。</p>}{waitingPending.length > 0 && <details className="rounded-xl border border-bdr bg-s2/50"><summary className="cursor-pointer px-3 py-3 text-xs font-bold text-ink-2">等待中的後續 {waitingPending.length} 項</summary><div className="space-y-2 border-t border-bdr px-3 py-3">{waitingPending.map((row) => <div key={row.id}><p className="text-sm text-ink">{row.title}</p><p className="text-[11px] text-ink-3">{row.waitingOn || '等待前置工作'}</p></div>)}</div></details>}</div>}
            <form onSubmit={addWork} className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="新增下一步…" className="min-h-11" />
              <button disabled={addingWork} className="btn-primary min-h-11 disabled:opacity-50">{addingWork ? '加入中…' : '加入'}</button>
              <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className="min-h-11 col-span-2" />
            </form>
          </section>}

          {(section === 'overview' || section === 'quotes') && <section id="case-quotes" className="card p-4"><div className="flex items-center justify-between"><h2 className="font-bold text-ink">案件報價與成交</h2><button type="button" onClick={() => onOpenQuote?.(item, null)} className="text-xs text-gold">＋ 新報價</button></div>{linkedQuotes.length === 0 && !linkedDeal && <p className="text-sm text-ink-3 mt-3">尚未建立報價或成交資料。</p>}{!linkedDeal?.quoteId && ['won', 'delivery', 'completed'].includes(getCasePipelineStageId(item, { deals, quotes })) && linkedQuotes.length > 0 && <p role="alert" className="mt-3 rounded-xl border border-copper/40 bg-copper/10 px-3 py-2 text-xs font-bold text-copper">⚠ 已標為成交，但還沒指定是哪一張報價成交。請在下方選一張「指定這張成交」。</p>}
{winnerError && <p role="alert" className="mt-2 text-xs font-semibold text-danger">{winnerError}</p>}
{linkedQuotes.map((quote) => <div key={quote.id} className="mt-3"><button type="button" onClick={() => onOpenQuote?.(item, quote.id)} className="w-full flex items-center justify-between gap-3 text-left"><div><p className="text-sm text-ink">{linkedDeal?.quoteId === quote.id ? '✓ 成交報價' : linkedDeal?.quoteId ? '未採用報價' : '報價'}・{quote.planName ? <b className="font-extrabold">{quote.planName}</b> : (quote.model || '未填車型')}</p><p className="text-xs text-ink-3">{quote.planName ? `${quote.model || '未填車型'}・` : ''}{quote.date}{quote.note ? `・${quote.note}` : ''}</p></div><strong className="text-gold">NT$ {formatMoney(quote.total)} ›</strong></button>
<button type="button" onClick={() => setDeleteQuote(quote)} className="mt-1 min-h-9 text-[11px] font-semibold text-ink-3 underline underline-offset-2">🗑 刪除這張報價{linkedDeal?.quoteId === quote.id ? '（已成交）' : ''}</button>
{!linkedDeal?.quoteId && item.status !== 'completed' && (pickWinnerId === quote.id
  ? <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-s2 p-2"><p className="col-span-2 text-xs text-ink-2">確定客戶選的是這一張（NT$ {formatMoney(quote.total)}）？其他報價會標為「未採用」，內容保留。</p><button type="button" disabled={winnerBusy} onClick={() => setPickWinnerId(null)} className="btn-outline min-h-10 text-xs">先不要</button><button type="button" disabled={winnerBusy} onClick={() => pickWinner(quote.id)} className="btn-primary min-h-10 text-xs disabled:opacity-50">{winnerBusy ? '儲存中…' : '確定成交'}</button></div>
  : <button type="button" onClick={() => { setPickWinnerId(quote.id); setWinnerError(''); }} className="btn-outline mt-2 min-h-10 w-full text-xs">✓ 指定這張成交</button>)}</div>)}{linkedDeal && <button type="button" onClick={() => onOpenOperations?.(linkedDeal.id, item.id)} className="mt-3 w-full flex items-center justify-between gap-3 text-left"><div><p className="text-sm text-ink">成交・{linkedDeal.model || linkedDeal.note || '車輛'}</p><p className="text-xs text-ink-3">{linkedDeal.date}</p></div><strong className="text-copper">NT$ {formatMoney(linkedDeal.amount)} ›</strong></button>}</section>}

          {section === 'overview' && item.status !== 'closed' && <>

          <CasePipeline item={item} currentId={pipelineStageId} deals={deals} quotes={quotes} onChangeStage={changePipelineStage} onOpenQuote={onOpenQuote} />
          {pipelineStageId !== 'completed' && (showClose
            ? <section className="card p-3"><p className="text-xs font-bold text-ink-2">為什麼不追了？（選一個就結案，可隨時重新追蹤）</p><div className="mt-2 grid grid-cols-2 gap-2">{CASE_CLOSE_REASONS.map((reason) => <button key={reason} type="button" disabled={closeBusy} onClick={() => closeCase(reason)} className="btn-outline min-h-11 text-xs font-bold disabled:opacity-50">{reason}</button>)}</div><button type="button" onClick={() => setShowClose(false)} className="mt-2 w-full min-h-9 text-xs text-ink-3">先不要</button></section>
            : <button type="button" onClick={() => setShowClose(true)} className="w-full min-h-10 rounded-xl border border-dashed border-bdr text-xs font-semibold text-ink-3">⏹ 不追了（沒興趣／買別家／聯絡不上…）</button>)}
          </>}
          {section === 'history' && <section className="card p-4"><h2 className="font-bold text-ink">案件紀錄</h2>{timeline.length === 0 ? <p className="text-sm text-ink-3 mt-3">目前沒有紀錄。</p> : <div className="mt-3 space-y-3">{timeline.map((row) => <div key={row.id} className="border-l-2 border-bdr pl-3"><p className="text-sm text-ink">{row.text}</p><p className="text-[11px] text-ink-3 mt-0.5">{dayjs(row.date || row.createdAt).format('YYYY/MM/DD HH:mm')}</p></div>)}</div>}</section>}
          {section === 'work' && completed.length > 0 && <details className="card p-4"><summary className="font-bold text-ink cursor-pointer">已完成工作 {completed.length} 項</summary><div className="mt-3 space-y-2">{completed.map((row) => <p key={row.id} className="text-sm text-ink-3 line-through">✓ {row.title}</p>)}</div></details>}
        </div>
        {showContact && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 md:items-center md:p-4"><form onSubmit={recordContact} className="w-full max-w-md rounded-t-3xl border border-bdr bg-s1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-panel md:rounded-2xl"><div className="flex items-center justify-between"><div><p className="text-xs font-bold text-teal">案件聯繫紀錄</p><h2 className="text-lg font-bold text-ink">{item.title}</h2></div><button type="button" onClick={() => setShowContact(false)} className="h-11 w-11 rounded-xl border border-bdr" aria-label="關閉">×</button></div>{pipelineStageId !== 'completed' && <div className="mt-4"><p className="text-xs font-bold text-ink-2">結果是？按一下就記好</p><div className="mt-2 grid grid-cols-2 gap-2">{CONTACT_PRESETS.map((preset) => <button key={preset.label} type="button" disabled={contactSaving} onClick={() => recordContact(null, preset)} className="btn-primary min-h-16 px-2 text-sm font-bold disabled:opacity-50">{preset.label}</button>)}</div></div>}<details className="mt-4 rounded-xl border border-bdr" open={pipelineStageId === 'completed'}><summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-ink-2">自己寫結果／指定日期</summary><div className="border-t border-bdr p-3"><label className="block text-xs font-bold text-ink-2">聯繫結果<textarea value={contactResult} onChange={(event) => setContactResult(event.target.value)} rows={3} placeholder="例：客戶確認要雙廂自排，等待貨款資料" className="mt-2 w-full resize-none" /></label>{pipelineStageId !== 'completed' && <label className="mt-4 block text-xs font-bold text-ink-2">下次追蹤日<input type="date" value={contactNextDate} onChange={(event) => setContactNextDate(event.target.value)} className="mt-2 min-h-12 w-full" /></label>}<button type="submit" disabled={contactSaving} className="btn-primary mt-3 min-h-12 w-full">{contactSaving ? '儲存中…' : '儲存聯繫紀錄'}</button></div></details>{contactError && <p role="alert" className="mt-3 rounded-xl bg-danger/10 p-3 text-sm text-danger">{contactError}</p>}</form></div>}
        {showEdit && <CaseEditSheet item={item} currentPipeline={pipelineStageId} workItems={caseWork} hasLinkedDeal={Boolean(linkedDeal)} onClose={() => setShowEdit(false)} onDeleted={() => { setShowEdit(false); onClose(); }} onSaveCase={onSaveCase} onDeleteCase={onDeleteCase} onSaveWorkItem={onSaveWorkItem} onSaveActivity={onSaveActivity} />}
      </div>
    </div>
  );
}

// 舊資料轉換時自動長出的案件，和同一位客戶的其他案件可能是同一筆生意。只列出來，由使用者決定；移到回收筒隨時可恢復。
function DuplicateCasesModal({ groups, deals, quotes, onClose, onTrash }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const describe = (item) => {
    const deal = findDealForCase(deals, item);
    const linkedQuotes = quotes.filter((row) => !row.archivedAt && ((item.quoteIds || []).includes(row.id) || row.caseId === item.id));
    const stage = getCasePipelineStage(item, { deals, quotes });
    return [CASE_TYPE_LABEL[item.type] || '案件', item.title || '未命名案件', stage, deal ? `成交 NT$ ${formatMoney(deal.amount)}` : '', linkedQuotes.length ? `${linkedQuotes.length} 張報價` : ''].filter(Boolean).join('・');
  };
  async function trash(id) {
    if (busyId) return;
    setBusyId(id); setError('');
    try { await onTrash(id); } catch (cause) { setError(cause?.message || '移到回收筒失敗，請再試一次。'); } finally { setBusyId(null); }
  }
  return (
    <div className="fixed inset-0 z-50 bg-bg safe-panel overflow-y-auto anim-slide-up">
      <div className="max-w-xl mx-auto min-h-full bg-s1 md:my-8 md:min-h-0 md:rounded-2xl md:border md:border-bdr">
        <header className="sticky top-0 z-10 bg-s1/95 backdrop-blur border-b border-bdr px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={onClose} className="btn-ghost min-h-11 px-3">←</button>
          <h2 className="font-bold text-lg text-ink flex-1">整理重複案件</h2>
        </header>
        <div className="p-4 space-y-5 pb-24">
          <p className="text-sm text-ink-2">下面標「自動產生」的案件，是系統轉換舊成交／舊報價時長出來的，可能和你自己建的案件是同一筆生意。確認重複就移到回收筒（隨時可在「回收筒」恢復，成交與報價資料不會刪）。</p>
          {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</p>}
          {groups.length === 0 && <p className="text-center text-ink-3 py-8">已經整理完了 ✓</p>}
          {groups.map((group) => (
            <section key={group.clientId} className="card p-4 space-y-3">
              <h3 className="font-bold text-ink">{group.clientName || '未命名客戶'}</h3>
              {group.otherCases.map((item) => <div key={item.id} className="rounded-xl bg-s2 px-3 py-2 text-xs text-ink-2"><span className="font-bold text-ok">保留</span>・{describe(item)}</div>)}
              {group.autoCases.map((item) => (
                <div key={item.id} className="rounded-xl border border-warn/40 bg-warn/5 px-3 py-2">
                  <p className="text-xs text-ink-2"><span className="font-bold text-warn">自動產生</span>・{describe(item)}</p>
                  <button type="button" disabled={busyId === item.id} onClick={() => trash(item.id)} className="btn-outline mt-2 min-h-10 w-full text-xs disabled:opacity-50">{busyId === item.id ? '處理中…' : '🗑 這是重複的，移到回收筒'}</button>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

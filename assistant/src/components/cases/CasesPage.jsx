import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import {
  advanceCasePipeline, buildWorkQueue, CASE_PIPELINE_STAGES, CASE_TYPE_LABEL, getCasePipelineElapsedDays, getCasePipelineStage, getCasePipelineStageId, getCasePipelineUpdatedAt, getCaseStatusLabel, getCaseTotalElapsedDays, resolveCaseFollowUpTarget, findDealForCase,
} from '../../utils/cases';
import { today } from '../../utils/date';
import { formatMoney, generateId } from '../../utils/crm';
import { normalizeDeliveryWorkflow } from '../../utils/delivery';
import CaseDeliveryChecklist from '../deals/CaseDeliveryChecklist';
import { ClientPicker } from '../ui';
import { STOCK_STATUSES, stockAlert, summarizeStock } from '../../utils/stock';

const STATUS_FILTERS = [...CASE_PIPELINE_STAGES.map((stage) => [stage.id, stage.label]), ['all', '全部'], ['deleted', '已刪除']];

export default function CasesPage({ focusId, startNewToken, initialClientId, onFocusConsumed, onStartConsumed, onNewClosed, onOpenClient, onOpenQuote, onOpenOperations }) {
  const { cases, deletedCases = [], workItems, activities, tasks, clients, deals, quoteDrafts, cats, stages, saveCase, saveDeal, deleteCase, restoreCase, saveWorkItem, saveActivity, saveClient, saveTask, updateClient } = useApp();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [restoringId, setRestoringId] = useState(null);
  const [restoreError, setRestoreError] = useState('');
  const [showStock, setShowStock] = useState(false);

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
      .filter((row) => filter === 'all' || filter === 'deleted' || getCasePipelineStageId(row, { deals, quotes: quoteDrafts }) === filter)
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

      <button type="button" onClick={() => setShowStock((value) => !value)} className={`min-h-12 w-full rounded-xl border px-4 text-left text-sm font-bold ${showStock ? 'border-copper bg-copper/12 text-copper' : 'border-bdr bg-s1 text-ink'}`}>📦 {showStock ? '返回案件列表' : '中央配件點貨・查看尚缺項目'}</button>
      {showStock ? <StockCenter deals={deals} cases={cases} onOpenCase={(id) => { setShowStock(false); setSelectedId(id); }} /> : <>

      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋姓名、電話、車牌、車型或案件名稱…" className="w-full min-h-11" />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTERS.map(([key, label]) => {
          const count = key === 'all' ? cases.length : key === 'deleted' ? deletedCases.length : cases.filter((row) => getCasePipelineStageId(row, { deals, quotes: quoteDrafts }) === key).length;
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
                    <div className="flex flex-wrap items-center gap-1.5"><span className="badge bg-danger/10 text-danger">已刪除</span><span className={`badge ${item.type === 'modification' ? 'bg-warn text-ink' : 'bg-danger text-white'}`}>{CASE_TYPE_LABEL[item.type] || '案件'}</span></div>
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
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className="card p-4 text-left hover:border-teal/50 active:scale-[0.99] transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className={`badge ${item.type === 'modification' ? 'bg-warn text-ink' : 'bg-danger text-white'}`}>{CASE_TYPE_LABEL[item.type] || '案件'}</span>
                      <span className="badge bg-copper/12 text-copper">{pipelineStage}</span>
                      {pipelineStageId === 'completed' && dayjs(stageUpdatedAt).isValid() && <span className="badge bg-ok/15 text-ok">{dayjs(stageUpdatedAt).format('YYYY 年 MM 月')}交車</span>}
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
                <p className="mt-1 text-[11px] font-semibold text-ink-2">{dayjs(stageUpdatedAt).isValid() ? `${dayjs(stageUpdatedAt).format('YYYY/MM/DD')} 進入${pipelineStage}・階段第 ${stageDays} 天｜案件總計 ${totalDays} 天` : '目前階段尚無日期紀錄'}</p>
                {deal?.quoteId && !stock.delivered && <p className={`mt-2 text-xs font-bold ${stock.deliveryRisk ? 'text-danger' : stock.missing ? 'text-copper' : 'text-ok'}`}>📦 {stock.missing ? `尚缺 ${stock.missing} 項配件${stock.deliveryRisk ? '・交車將近' : ''}` : '配件已核對完成'}{stock.inquiryNoDate ? '・待廠商確認未排再追日' : ''}</p>}
              </button>
            );
          })}
        </div>
      )}
      </>}

      {showNew && <NewCaseModal clients={clients} cats={cats} stages={stages} initialClientId={initialClientId} onClose={() => { setShowNew(false); onNewClosed?.(); }} onSaveCase={saveCase} onSaveClient={saveClient} onSaveWorkItem={saveWorkItem} onSaveActivity={saveActivity} onCreated={(id) => { setShowNew(false); onNewClosed?.(); setSelectedId(id); }} />}
      {selected && <CaseDetail key={selected.id} item={selected} workItems={workItems} tasks={tasks} caseQueue={workQueue.filter((row) => row.caseId === selected.id)} activities={activities} deals={deals} quotes={quoteDrafts} onClose={() => setSelectedId(null)} onSaveCase={saveCase} onSaveDeal={saveDeal} onDeleteCase={deleteCase} onSaveWorkItem={saveWorkItem} onSaveActivity={saveActivity} onSaveTask={saveTask} onUpdateClient={updateClient} onOpenClient={onOpenClient} onOpenQuote={onOpenQuote} onOpenOperations={onOpenOperations} />}
    </div>
  );
}

function StockCenter({ deals, cases, onOpenCase }) {
  const groups = summarizeStock(deals, cases).filter((group) => group.missing > 0);
  const unverified = deals.filter((deal) => !deal.quoteId && !deal.caseArchivedAt && cases.some((item) => (item.id === deal.caseId || item.dealId === deal.id) && item.status !== 'completed'));
  return <section className="card p-4 space-y-3"><div><h2 className="font-bold text-ink">尚缺配件</h2><p className="mt-1 text-xs text-ink-3">只統計已指定成交報價、尚未完工案件；同規格合併，逐案核對。</p></div>{unverified.length > 0 && <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn">另有 {unverified.length} 筆舊成交尚未指定成交報價，配件需求未納入統計，請先核對。</p>}{groups.length === 0 && <p className="rounded-xl bg-s2 p-4 text-sm text-ink-2">目前沒有待備的配件。</p>}{groups.map((group) => <div key={group.key} className="rounded-xl border border-bdr bg-s2 p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-bold text-ink">{group.name}{group.specification ? `・${group.specification}` : ''}</p><p className="text-xs text-ink-3">總需求 {group.needed}・已備 {group.ready}</p></div><strong className="shrink-0 text-sm text-danger">尚缺 {group.missing}</strong></div><div className="mt-2 space-y-1">{group.cases.filter((row) => !['ready', 'installed', 'not_needed'].includes(row.status)).map((row) => <button key={`${row.dealId}:${row.id}`} type="button" onClick={() => onOpenCase(row.caseId)} className="block min-h-10 w-full rounded-lg bg-s1 px-3 py-2 text-left text-xs text-ink-2">{row.clientName || '未命名客戶'}・{STOCK_STATUSES.find(([id]) => id === row.status)?.[1] || '未處理'} ›</button>)}</div></div>)}</section>;
}

function StockChecklist({ deal, quote, delivered = false, onSaveDeal, onError }) {
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
  const missing = items.filter((item) => !['ready', 'installed', 'not_needed'].includes(item.status));
  return <section id="case-stock" className="card p-4"><div className="flex items-center justify-between gap-2"><h2 className="font-bold text-ink">📦 成交配件逐項核對</h2><span className={`text-xs font-bold ${delivered ? 'text-ink-3' : missing.length ? 'text-copper' : 'text-ok'}`}>{delivered ? '已交車' : missing.length ? `尚缺 ${missing.length} 項` : '已全部核對'}</span></div><p className="mt-1 text-xs text-ink-3">只依「{quote?.model || deal.model || '成交報價'}」的成交版本建立。贈送實體配件也要核對。</p>{deal.pricingNeedsReview && <p className="mt-2 rounded-lg bg-warn/10 p-2 text-xs font-bold text-warn">舊成交已連結報價；原成交價與成本紀錄保留，請到後台核對利潤。</p>}{(quote?.requirements || quote?.note) && <div className="mt-2 rounded-lg border border-copper/30 bg-copper/10 p-3"><p className="text-xs font-bold text-copper">聯繫廠商前必看</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-ink-2">{[quote.requirements, quote.note].filter(Boolean).join('\n')}</p></div>}{items.length === 0 && <p className="mt-3 rounded-lg bg-s2 p-3 text-xs text-ink-3">這張報價沒有可核對的配件。</p>}<div className="mt-3 space-y-2">{items.map((row) => <StockRow key={row.id} row={row} disabled={saving} onUpdate={(patch) => updateStock(row.id, patch)} />)}</div></section>;
}

function StockRow({ row, disabled, onUpdate }) {
  const [note, setNote] = useState(row.note || '');
  const ready = ['ready', 'installed'].includes(row.status);
  return <div className="rounded-xl border border-bdr bg-s2 p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="font-bold text-ink">{row.name}{row.specification ? `・${row.specification}` : ''} × {row.quantity || 1}</p>
        {row.fromBundle && <p className="text-[11px] text-ink-3">來自套件：{row.fromBundle}</p>}
        {row.gift && <p className="text-[11px] text-copper">贈送配件，仍需備品</p>}
        {row.note && <p className="mt-1 whitespace-pre-wrap text-xs text-ink-2">備註：{row.note}</p>}
      </div>
      <button type="button" disabled={disabled || ['installed', 'not_needed'].includes(row.status)} onClick={() => onUpdate({ status: ready ? 'todo' : 'ready' })} className={`min-h-11 shrink-0 rounded-lg border px-3 text-xs font-bold ${ready ? 'border-ok bg-ok/15 text-ok' : 'border-copper bg-copper/10 text-copper'}`}>{row.status === 'installed' ? '✓ 已安裝' : row.status === 'not_needed' ? '不需備品' : ready ? '✓ 已備妥' : '□ 備妥'}</button>
    </div>
    <div className="mt-2 grid grid-cols-2 gap-2">
      <select aria-label={`${row.name}備品狀態`} value={row.status || 'todo'} onChange={(e) => onUpdate({ status: e.target.value })} disabled={disabled} className="min-h-11 w-full text-sm">{STOCK_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      {row.status === 'inquiry'
        ? <label className="block text-[11px] text-ink-3">再追廠商日期<input type="date" value={row.followUpDate || ''} onChange={(e) => onUpdate({ followUpDate: e.target.value })} aria-label={`${row.name}再追日期`} className={`min-h-11 w-full text-sm ${row.followUpDate ? '' : 'border-danger'}`} disabled={disabled} /></label>
        : <span />}
    </div>
    {row.status === 'inquiry' && !row.followUpDate && <p className="mt-1 text-[11px] font-bold text-danger">待廠商確認，請設定再追日期</p>}
    <details className="mt-1 text-xs text-ink-2"><summary className="min-h-10 cursor-pointer py-2">修改數量或備註</summary>
      <div className="space-y-2 pt-1">
        <label className="block">數量<input type="number" aria-label={`${row.name}數量`} min="1" value={row.quantity || 1} onChange={(e) => onUpdate({ quantity: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 min-h-11 w-full" disabled={disabled} /></label>
        <label className="block">廠商／客戶要求<input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note !== (row.note || '')) onUpdate({ note }); }} placeholder="規格、廠商或客戶特殊要求" aria-label={`${row.name}備註`} className="mt-1 min-h-11 w-full" /></label>
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
    const createdAt = new Date().toISOString();
    const item = await onSaveCase(advanceCasePipeline({
      id, clientId: client.id, clientName: client.name, type, status: 'active',
      title: title.trim() || (type === 'purchase' ? '買車案件' : '改裝案件'), source: 'manual', quoteIds: [], dealId: null,
      lastContactAt: null, createdAt, updatedAt: createdAt,
      nextFollowUpDate, followUpPlanMode: followUpMode,
      followUpPlanBaseDate: followUpMode === 'relative' ? today() : null,
      followUpPlanAmount: followUpMode === 'relative' ? Number(followUpAmount) : null,
      followUpPlanUnit: followUpMode === 'relative' ? followUpUnit : null,
    }, 'new', createdAt));
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
              {[['purchase', '🚛 購車'], ['modification', '🛠️ 改車']].map(([key, label]) => <button key={key} type="button" onClick={() => setType(key)} className={`min-h-16 rounded-xl border text-base font-bold ${type === key ? (key === 'purchase' ? 'border-danger bg-danger text-white' : 'border-warn bg-warn text-ink') : 'border-bdr'}`}>{label}</button>)}
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
          ? <button type="button" onClick={() => nextStage.id === 'won' && !hasDeal ? onOpenQuote?.(item, (item.quoteIds || [])[0] || null) : setConfirmStageId(nextStage.id)} className="btn-primary min-h-12">{nextStage.id === 'won' && !hasDeal ? '先選擇成交報價 →' : `下一階段：${nextStage.label} →`}</button>
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
          <section><p className="text-xs font-bold text-ink-2">案件種類</p><div className="mt-2 grid grid-cols-2 gap-2">{[['purchase', '🚛 購車案件'], ['modification', '🛠️ 改車案件']].map(([key, label]) => <button key={key} type="button" onClick={() => setType(key)} className={`min-h-12 rounded-xl border font-bold ${type === key ? (key === 'purchase' ? 'border-danger bg-danger text-white' : 'border-warn bg-warn text-ink') : 'border-bdr text-ink-2'}`}>{label}</button>)}</div></section>
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

function CaseDetail({ item, workItems, tasks, caseQueue, activities, deals, quotes, onClose, onSaveCase, onSaveDeal, onDeleteCase, onSaveWorkItem, onSaveActivity, onSaveTask, onUpdateClient, onOpenClient, onOpenQuote, onOpenOperations }) {
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
  const workflow = normalizeDeliveryWorkflow(linkedDeal || {});
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
        ...advanceCasePipeline(item, pipelineStageId === 'new' ? 'follow_up' : pipelineStageId, timestamp),
        lastContactAt: timestamp,
        nextFollowUpDate: pipelineStageId === 'completed' ? '' : contactNextDate,
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
          <CasePipeline item={item} currentId={pipelineStageId} deals={deals} quotes={quotes} onChangeStage={changePipelineStage} onOpenQuote={onOpenQuote} />
          <section className="grid grid-cols-3 gap-2">
            <button type="button" disabled={!item.clientId} onClick={() => item.clientId && onOpenClient?.(item.clientId)} className="card min-h-16 px-2 py-3 text-xs font-bold text-accent disabled:opacity-40">👤 客戶資料</button>
            <button type="button" onClick={() => onOpenQuote?.(item, linkedQuotes[0]?.id || null)} className="card min-h-16 px-2 py-3 text-xs font-bold text-gold">🧾 {linkedQuotes.length ? `報價 ${linkedQuotes.length}` : '建立報價'}</button>
            <button type="button" disabled={!linkedDeal} onClick={goToSop} className="card min-h-16 px-2 py-3 text-xs font-bold text-copper disabled:opacity-40">🚚 {linkedDeal ? '施工進度' : '尚未成交'}</button>
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

          {section === 'overview' && linkedDeal && <section className="card p-4 space-y-3"><h2 className="font-bold text-ink">交車目標與優先度</h2><div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label className="text-xs text-ink-2">客戶希望交車日<input type="date" value={desiredDate} onChange={(e) => setDesiredDate(e.target.value)} className="mt-1 w-full min-h-11" /></label><label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />急件</label></div>{urgent && <input value={urgentReason} onChange={(e) => setUrgentReason(e.target.value)} placeholder="急件原因，例如工作用車急需" className="w-full min-h-11" />}<button type="button" onClick={async () => { try { await onSaveCase({ ...item, desiredDeliveryDate: desiredDate, urgent, urgentReason: urgent ? urgentReason.trim() : '' }); setStockError(''); } catch (cause) { setStockError(cause?.message || '儲存失敗'); } }} className="btn-outline min-h-11 w-full">儲存交車目標</button></section>}

          {(section === 'overview' || section === 'work') && linkedDeal && <CaseDeliveryChecklist key={linkedDeal.id} deal={linkedDeal} caseItem={item} onGoStock={goToStock} />}

          {(section === 'overview' || section === 'work') && linkedDeal && <StockChecklist delivered={item.status === 'completed'} deal={linkedDeal} quote={linkedDeal.quoteSnapshot || linkedQuotes.find((quote) => quote.id === linkedDeal.quoteId)} onSaveDeal={onSaveDeal} onError={setStockError} />}
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

          {(section === 'overview' || section === 'quotes') && <section className="card p-4"><div className="flex items-center justify-between"><h2 className="font-bold text-ink">案件報價與成交</h2><button type="button" onClick={() => onOpenQuote?.(item, null)} className="text-xs text-gold">＋ 新報價</button></div>{linkedQuotes.length === 0 && !linkedDeal && <p className="text-sm text-ink-3 mt-3">尚未建立報價或成交資料。</p>}{linkedQuotes.map((quote) => <button type="button" onClick={() => onOpenQuote?.(item, quote.id)} key={quote.id} className="mt-3 w-full flex items-center justify-between gap-3 text-left"><div><p className="text-sm text-ink">{linkedDeal?.quoteId === quote.id ? '✓ 成交報價' : linkedDeal?.quoteId ? '未採用報價' : '報價'}・{quote.model || '未填車型'}</p><p className="text-xs text-ink-3">{quote.date}</p></div><strong className="text-gold">NT$ {formatMoney(quote.total)} ›</strong></button>)}{linkedDeal && <button type="button" onClick={() => onOpenOperations?.(linkedDeal.id, item.id)} className="mt-3 w-full flex items-center justify-between gap-3 text-left"><div><p className="text-sm text-ink">成交・{linkedDeal.model || linkedDeal.note || '車輛'}</p><p className="text-xs text-ink-3">{linkedDeal.date}</p></div><strong className="text-copper">NT$ {formatMoney(linkedDeal.amount)} ›</strong></button>}</section>}

          {section === 'history' && <section className="card p-4"><h2 className="font-bold text-ink">案件紀錄</h2>{timeline.length === 0 ? <p className="text-sm text-ink-3 mt-3">目前沒有紀錄。</p> : <div className="mt-3 space-y-3">{timeline.map((row) => <div key={row.id} className="border-l-2 border-bdr pl-3"><p className="text-sm text-ink">{row.text}</p><p className="text-[11px] text-ink-3 mt-0.5">{dayjs(row.date || row.createdAt).format('YYYY/MM/DD HH:mm')}</p></div>)}</div>}</section>}
          {section === 'work' && completed.length > 0 && <details className="card p-4"><summary className="font-bold text-ink cursor-pointer">已完成工作 {completed.length} 項</summary><div className="mt-3 space-y-2">{completed.map((row) => <p key={row.id} className="text-sm text-ink-3 line-through">✓ {row.title}</p>)}</div></details>}
        </div>
        {showContact && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 md:items-center md:p-4"><form onSubmit={recordContact} className="w-full max-w-md rounded-t-3xl border border-bdr bg-s1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-panel md:rounded-2xl"><div className="flex items-center justify-between"><div><p className="text-xs font-bold text-teal">案件聯繫紀錄</p><h2 className="text-lg font-bold text-ink">{item.title}</h2></div><button type="button" onClick={() => setShowContact(false)} className="h-11 w-11 rounded-xl border border-bdr" aria-label="關閉">×</button></div><label className="mt-4 block text-xs font-bold text-ink-2">這次聯繫結果<textarea value={contactResult} onChange={(event) => setContactResult(event.target.value)} rows={3} placeholder="例：客戶確認要雙廂自排，等待貨款資料" className="mt-2 w-full resize-none" /></label>{pipelineStageId !== 'completed' && <label className="mt-4 block text-xs font-bold text-ink-2">下次追蹤日<input type="date" value={contactNextDate} onChange={(event) => setContactNextDate(event.target.value)} className="mt-2 min-h-12 w-full" /></label>}{contactError && <p role="alert" className="mt-3 rounded-xl bg-danger/10 p-3 text-sm text-danger">{contactError}</p>}<div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => setShowContact(false)} className="btn-outline min-h-12">取消</button><button type="submit" disabled={contactSaving} className="btn-primary min-h-12">{contactSaving ? '儲存中…' : '儲存聯繫紀錄'}</button></div></form></div>}
        {showEdit && <CaseEditSheet item={item} currentPipeline={pipelineStageId} workItems={caseWork} hasLinkedDeal={Boolean(linkedDeal)} onClose={() => setShowEdit(false)} onDeleted={() => { setShowEdit(false); onClose(); }} onSaveCase={onSaveCase} onDeleteCase={onDeleteCase} onSaveWorkItem={onSaveWorkItem} onSaveActivity={onSaveActivity} />}
      </div>
    </div>
  );
}

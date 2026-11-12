import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { findDuplicateClient, formatMoney, generateId } from '../../utils/crm';
import { addDays, today } from '../../utils/date';
import { CASE_PIPELINE_STAGES, CASE_TYPE_LABEL, getCasePipelineElapsedDays, getCasePipelineStageId, getCasePipelineUpdatedAt, getCaseTotalElapsedDays, inferCaseType, findDealForCase } from '../../utils/cases';
import { getQuoteAttention } from '../../utils/quotes';
import QuoteModal from './QuoteModal';
import { ClientPicker } from '../ui';

function pendingCount(quote) {
  return (quote?.items || []).filter((item) => item.pending).length;
}

function requirementPendingCount(quote) {
  return Array.isArray(quote?.pendingRequirements) ? quote.pendingRequirements.length : 0;
}

export default function QuoteWorkspace({ onOpenClient, startNewToken, onStartConsumed, focusId, onFocusConsumed, caseContext, onCaseContextConsumed, onReturnToCase }) {
  const {
    clients, cases, deals, quoteDrafts, saveQuoteDraft, archiveQuoteDraft, restoreQuoteDraft, confirmQuoteDeal,
    savePricingRecord, saveClient, updateClient, cats, stages,
  } = useApp();
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [saveNotice, setSaveNotice] = useState(null);
  const [confirmDealId, setConfirmDealId] = useState(null);
  const [viewWonQuoteId, setViewWonQuoteId] = useState(null);
  const [dealError, setDealError] = useState('');
  const [dealSaving, setDealSaving] = useState(false);
  const dealBusy = useRef(false);
  const [assigningId, setAssigningId] = useState(null);
  const [assignClientId, setAssignClientId] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [fromCaseId, setFromCaseId] = useState(null); // 從案件開的報價：存檔、關閉或成交後回到該案件

  function finishAndReturn() {
    const target = fromCaseId;
    setFromCaseId(null);
    if (target) onReturnToCase?.(target);
  }

  useEffect(() => {
    if (startNewToken) {
      setEditing({ mode: 'new' });
      onStartConsumed?.();
    }
  }, [startNewToken, onStartConsumed]);

  useEffect(() => {
    if (!focusId) return;
    const quote = quoteDrafts.find((row) => row.id === focusId);
    if (quote) {
      if (deals.some((deal) => deal.quoteId === quote.id && !deal.caseArchivedAt)) setViewWonQuoteId(quote.id);
      else { setEditing({ mode: 'edit', quote }); if (quote.caseId) setFromCaseId(quote.caseId); }
    }
    onFocusConsumed?.();
  }, [focusId, quoteDrafts, deals, onFocusConsumed]);

  useEffect(() => {
    if (!caseContext?.token) return;
    setEditing({ mode: 'new', caseId: caseContext.caseId, clientId: caseContext.clientId });
    setFromCaseId(caseContext.caseId || null);
    onCaseContextConsumed?.();
  }, [caseContext, onCaseContextConsumed]);

  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const caseById = useMemo(() => new Map(cases.map((item) => [item.id, item])), [cases]);
  const caseByQuoteId = useMemo(() => {
    const map = new Map();
    cases.forEach((item) => (item.quoteIds || []).forEach((quoteId) => map.set(quoteId, item)));
    return map;
  }, [cases]);
  const linkedCaseFor = (quote) => caseById.get(quote.caseId) || caseByQuoteId.get(quote.id) || null;
  const dealByCase = useMemo(() => new Map(cases.map((row) => [row.id, findDealForCase(deals, row)]).filter(([, deal]) => deal)), [cases, deals]);
  const quoteState = (quote) => {
    const caseItem = linkedCaseFor(quote);
    if (!caseItem) return 'unlinked';
    const deal = dealByCase.get(caseItem.id);
    return deal?.quoteId === quote.id ? 'won' : deal?.quoteId ? 'not_chosen' : 'pending';
  };
  const activeQuotes = useMemo(() => quoteDrafts.filter((quote) => !quote.archivedAt), [quoteDrafts]);
  const archivedQuotes = useMemo(() => quoteDrafts.filter((quote) => quote.archivedAt), [quoteDrafts]);
  const stageCounts = activeQuotes.reduce((counts, quote) => {
    counts[quoteState(quote)] += 1;
    return counts;
  }, { pending: 0, won: 0, not_chosen: 0, unlinked: 0 });
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = stageFilter === 'trash' ? archivedQuotes : activeQuotes;
    return [...source]
      .sort((a, b) => (b.updatedAt || b.date || '').localeCompare(a.updatedAt || a.date || ''))
      .filter((quote) => {
        const linkedCase = linkedCaseFor(quote);
        const quoteType = linkedCase?.type || inferCaseType(quote);
        if (stageFilter !== 'all' && stageFilter !== 'trash' && quoteState(quote) !== stageFilter) return false;
        if (!needle) return true;
        const linked = clientMap.get(quote.clientId);
        return [CASE_TYPE_LABEL[quoteType], quote.customerName, quote.customerPhone, quote.model, quote.requirements, linked?.name, linked?.phone]
          .some((value) => String(value || '').toLowerCase().includes(needle));
      });
  }, [activeQuotes, archivedQuotes, quoteDrafts, query, stageFilter, clientMap, caseById, caseByQuoteId, dealByCase]);

  async function handleSave(payload) {
    const { _pricingRecord, _customerMode, _confirmAfterSave, ...quotePayload } = payload;
    const previousQuote = quoteDrafts.find((row) => row.id === quotePayload.id);
    if (previousQuote && deals.some((deal) => deal.quoteId === previousQuote.id && !deal.caseArchivedAt)) throw new Error('成交報價已鎖定，不能直接覆蓋；若內容變更，請另建報價並核對成交內容。');
    let clientId = quotePayload.clientId || null;
    let createdClient = null;

    if (_customerMode === 'new' && !clientId) {
      const duplicate = findDuplicateClient(clients, {
        name: quotePayload.customerName,
        phone: quotePayload.customerPhone,
      });
      if (duplicate?.reason === 'phone') {
        clientId = duplicate.client.id;
      } else {
        createdClient = await saveClient({
          id: generateId('client'),
          name: quotePayload.customerName.trim(),
          phone: quotePayload.customerPhone.trim(),
          source: '直接報價',
          catId: cats[0]?.id || '',
          stageId: stages.find((stage) => stage.name === '報價')?.id || stages[0]?.id || '',
          clientType: 'personal',
          intentLevel: 0,
          nextDate: addDays(today(), 7),
          notes: quotePayload.requirements || '',
          log: [],
          quotes: [],
          missedCalls: 0,
        });
        clientId = createdClient.id;
      }
    }

    const quote = await saveQuoteDraft({ ...quotePayload, clientId });

    if (previousQuote?.clientId && previousQuote.clientId !== clientId) {
      await updateClient(previousQuote.clientId, (current) => ({
        ...current,
        log: (current.log || []).filter((row) => row.quoteId !== quote.id),
      }));
    }

    if (clientId) {
      await updateClient(clientId, (current) => {
        const log = [...(current.log || [])];
        const logIndex = log.findIndex((row) => row.quoteId === quote.id);
        const logEntry = {
          id: logIndex >= 0 ? log[logIndex].id : generateId('log'),
          date: quote.date || today(),
          type: 'quote',
          quoteId: quote.id,
          text: quote.text,
          amount: quote.total,
        };
        if (logIndex === -1) log.push(logEntry);
        else log[logIndex] = { ...log[logIndex], ...logEntry };
        const next = { ...current, log, lastContact: quote.date || today(), missedCalls: 0 };
        delete next.quotes;
        return next;
      });
    }

    if (_pricingRecord) {
      await savePricingRecord({
        ..._pricingRecord,
        clientId: quote.clientId || null,
        quoteId: quote.id,
      });
    }
    setSaveNotice(clientId ? {
      clientId,
      text: createdClient
        ? `已建立「${createdClient.name}」並把報價連結到客戶追蹤。`
        : '報價已儲存並連結到客戶追蹤。',
    } : { clientId: null, text: '報價已儲存；未建立客戶資料。' });
    setEditing(null);
    if (!_confirmAfterSave && (editing?.caseId || fromCaseId)) finishAndReturn();
  }

  async function assignQuoteToClient(quote) {
    const client = clientMap.get(assignClientId);
    if (!client || assignBusy) return;
    setAssignBusy(true);
    try {
      await handleSave({ ...quote, clientId: client.id, customerName: client.name, customerPhone: client.phone || quote.customerPhone || '', _customerMode: 'existing', _confirmAfterSave: true });
      setAssigningId(null);
      setAssignClientId('');
      setSaveNotice({ clientId: client.id, text: `報價已歸入「${client.name}」。` });
    } catch (cause) {
      setSaveNotice({ clientId: null, text: cause?.message || '歸入客戶失敗，請再試一次。' });
    } finally {
      setAssignBusy(false);
    }
  }

  async function moveQuoteToTrash(id) {
    await archiveQuoteDraft(id);
    setConfirmDeleteId(null);
    setSaveNotice({ clientId: null, text: '報價已放入垃圾車，資料仍保留並可隨時恢復。' });
  }

  async function restoreQuote(id) {
    await restoreQuoteDraft(id);
    setSaveNotice({ clientId: null, text: '報價已從垃圾車恢復。' });
  }

  async function confirmDeal() {
    if (dealBusy.current) return;
    dealBusy.current = true;
    setDealSaving(true);
    setDealError('');
    try {
      const deal = await confirmQuoteDeal(confirmDealId);
      setConfirmDealId(null);
      setSaveNotice({ clientId: deal.clientId, text: '已指定此張報價成交，並建立本案件配件核對表。' });
      setEditing(null);
      finishAndReturn();
    } catch (cause) {
      setDealError(cause?.message || '確認成交失敗，請稍後重試。');
    } finally {
      dealBusy.current = false;
      setDealSaving(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-5 py-4 md:py-6 space-y-4">
      <section className="rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/16 via-s1 to-copper/8 p-4 md:p-5 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-gold">QUOTATION WORKSPACE</p>
            <h1 className="text-xl md:text-2xl font-bold text-ink mt-1">🧾 報價管理</h1>
            <p className="text-sm text-ink-2 mt-2 leading-relaxed max-w-2xl">
              可直接建立客戶並開始報價，不必先走接待流程；也能連結既有客戶或只做匿名報價。完成後可輸出圖片或 LINE 文字版。
            </p>
          </div>
          <button onClick={() => setEditing({ mode: 'new' })} className="btn-primary shrink-0">
            ＋ 新報價
          </button>
        </div>
      </section>

      <div className="flex items-center gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋客戶、電話、車型、案件或需求…" className="flex-1 text-sm" />
        <span className="text-xs text-ink-3 shrink-0">{rows.length} 張</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="案件進度篩選">
        {[
          ['all', '全部', activeQuotes.length],
          ['pending', '待成交', stageCounts.pending],
          ['won', '成交報價', stageCounts.won],
          ['not_chosen', '未採用', stageCounts.not_chosen],
          ['unlinked', '未歸入案件', stageCounts.unlinked],
          ['trash', '🗑 垃圾車', archivedQuotes.length],
        ].map(([key, label, count]) => <button key={key} type="button" onClick={() => setStageFilter(key)} className={`min-h-11 shrink-0 rounded-full border px-3 text-sm font-semibold ${stageFilter === key ? 'border-teal bg-teal text-white' : 'border-bdr bg-s1 text-ink-2'}`}>{label} {count}</button>)}
      </div>
      {stageFilter !== 'trash' && (
        <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
          <span className="rounded-full border border-danger/40 bg-danger/10 px-2.5 py-1 text-danger">紅色：未分配客戶超過 30 天</span>
          <span className="rounded-full border border-ink-3/30 bg-ink-3/10 px-2.5 py-1 text-ink-3">灰色：已分配客戶超過 90 天</span>
          <span className="rounded-full border border-bdr bg-s1 px-2.5 py-1 text-ink-2">🗑 可隱藏並恢復</span>
        </div>
      )}

      {saveNotice && (
        <div className="rounded-xl border border-ok/30 bg-ok/10 px-3 py-2 flex items-center gap-2 text-sm text-ink-2">
          <span className="flex-1">✓ {saveNotice.text}</span>
          {saveNotice.clientId && onOpenClient && (
            <button type="button" onClick={() => onOpenClient(saveNotice.clientId)} className="btn-outline text-xs shrink-0">開啟客戶</button>
          )}
          <button type="button" onClick={() => setSaveNotice(null)} className="btn-ghost px-2">×</button>
        </div>
      )}

      {rows.length === 0 ? (
        <section className="card p-8 text-center">
          <div className="text-4xl">🧾</div>
          <h2 className="font-semibold text-ink mt-3">{query ? '找不到符合的報價' : stageFilter === 'trash' ? '垃圾車目前是空的' : '還沒有報價'}</h2>
          <p className="text-sm text-ink-3 mt-1">{query ? '換個關鍵字試試看。' : stageFilter === 'trash' ? '放入垃圾車的報價會保留在這裡，可隨時恢復。' : '按「新報價」建立第一張報價單。'}</p>
          {!query && stageFilter !== 'trash' && <button onClick={() => setEditing({ mode: 'new' })} className="btn-primary mt-4">＋ 建立報價</button>}
        </section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((quote) => {
            const linked = clientMap.get(quote.clientId);
            const customer = quote.customerName || linked?.name || '未填客戶';
            const linkedCase = linkedCaseFor(quote);
            const linkedDeal = linkedCase ? dealByCase.get(linkedCase.id) : null;
            const isWon = linkedDeal?.quoteId === quote.id;
            const quoteType = linkedCase?.type || inferCaseType(quote);
            const pipelineStageId = linkedCase ? getCasePipelineStageId(linkedCase, { quotes: quoteDrafts }) : null;
            const pipelineStage = CASE_PIPELINE_STAGES.find((stage) => stage.id === pipelineStageId);
            const stageUpdatedAt = linkedCase ? getCasePipelineUpdatedAt(linkedCase, { quotes: quoteDrafts }) : '';
            const stageDays = linkedCase ? getCasePipelineElapsedDays(linkedCase, { quotes: quoteDrafts }) : null;
            const totalDays = linkedCase ? getCaseTotalElapsedDays(linkedCase, { quotes: quoteDrafts }) : null;
            const pending = pendingCount(quote);
            const pendingRequirements = requirementPendingCount(quote);
            const attention = getQuoteAttention(quote);
            const attentionClass = attention.unassignedOverdue
              ? 'border-danger/60 bg-danger/10'
              : attention.linkedStale ? 'border-ink-3/35 bg-ink-3/10 opacity-80' : '';
            return (
              <article key={quote.id} className={`card p-4 space-y-3 ${attentionClass}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`badge ${quoteType === 'modification' ? 'bg-warn text-ink' : 'bg-danger text-white'}`}>{CASE_TYPE_LABEL[quoteType]}</span>
                      {pipelineStage && (['new', 'follow_up'].includes(pipelineStage.id) || isWon) && <span className="badge bg-copper/12 text-copper">{CASE_PIPELINE_STAGES.findIndex((stage) => stage.id === pipelineStage.id) + 1} {pipelineStage.label}</span>}
                      {isWon && <span className="badge bg-ok/15 text-ok">✓ 本張報價成交</span>}
                      {linkedDeal?.quoteId && !isWon && <span className="badge bg-s2 text-ink-3">未採用</span>}
                      {linkedDeal && !linkedDeal.quoteId && <span className="badge bg-warn/10 text-warn">成交報價待核對</span>}
                      {isWon && pipelineStageId === 'completed' && dayjs(stageUpdatedAt).isValid() && <span className="badge bg-ok/15 text-ok">{dayjs(stageUpdatedAt).format('YYYY 年 MM 月')}交車</span>}
                      {!linkedCase && <span className="badge bg-warn/10 text-warn">未歸入案件</span>}
                      {attention.unassignedOverdue && <span className="badge bg-danger text-white">未分配客戶超過 30 天</span>}
                      {attention.linkedStale && <span className="badge bg-ink-3 text-white">已超過 90 天</span>}
                      {quote.archivedAt && <span className="badge bg-ink-3 text-white">垃圾車</span>}
                      <h2 className="font-semibold text-ink truncate">{customer}</h2>
                      {linked && <span className="text-[10px] rounded-full bg-accent/10 text-accent border border-accent/30 px-2 py-0.5">已連結客戶</span>}
                      {pending > 0
                        ? <span className="text-[10px] rounded-full bg-warn/10 text-warn border border-warn/30 px-2 py-0.5">待廠商報價 {pending} 項</span>
                        : <span className="text-[10px] rounded-full bg-ok/10 text-ok border border-ok/30 px-2 py-0.5">價格已齊</span>}
                      {pendingRequirements > 0 && <span className="text-[10px] rounded-full bg-warn/10 text-warn border border-warn/30 px-2 py-0.5">需求待確認 {pendingRequirements} 項</span>}
                    </div>
                    <p className="text-xs text-ink-3 mt-1">{quote.model || '未填車型'}・{dayjs(quote.date).format('YYYY/MM/DD')}</p>
                    {attention.ageDays != null && <p className={`mt-1 text-[11px] font-semibold ${attention.unassignedOverdue ? 'text-danger' : attention.linkedStale ? 'text-ink-3' : 'text-ink-2'}`}>報價已建立第 {attention.ageDays} 天{attention.linked ? '・已分配客戶' : '・尚未分配客戶'}</p>}
                    {pipelineStage && (['new', 'follow_up'].includes(pipelineStage.id) || isWon) && <p className="mt-1 text-[11px] font-semibold text-ink-2">{dayjs(stageUpdatedAt).format('YYYY/MM/DD')} 進入{pipelineStage.label}・階段第 {stageDays} 天｜案件總計 {totalDays} 天</p>}
                  </div>
                  <p className="text-right shrink-0">
                    <span className="block text-[10px] text-ink-3">{pending > 0 ? '目前金額' : '專案價'}</span>
                    <strong className="text-accent">NT$ {formatMoney(quote.total)}</strong>
                  </p>
                </div>

                {!quote.archivedAt && !quote.clientId && (assigningId === quote.id ? (
                  <div className="rounded-xl border border-teal/30 bg-teal/8 p-3 space-y-2">
                    <p className="text-xs font-semibold text-teal">歸入哪位客戶？</p>
                    <ClientPicker clients={clients} value={assignClientId} onChange={setAssignClientId} placeholder="輸入姓名或電話搜尋客戶…" />
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => { setAssigningId(null); setAssignClientId(''); }} className="btn-outline min-h-10 text-xs">先不要</button>
                      <button type="button" disabled={!assignClientId || assignBusy} onClick={() => assignQuoteToClient(quote)} className="btn-primary min-h-10 text-xs disabled:opacity-40">{assignBusy ? '歸入中…' : '確定歸入'}</button>
                    </div>
                  </div>
                ) : <button type="button" onClick={() => { setAssigningId(quote.id); setAssignClientId(''); }} className="btn-outline min-h-10 w-full text-xs">👤 歸入客戶</button>)}

                {quote.requirements && (
                  <p className="text-xs text-ink-2 bg-s2 rounded-lg px-3 py-2 line-clamp-3 whitespace-pre-wrap">{quote.requirements}</p>
                )}

                <div className="flex items-center gap-2">
                  {!quote.archivedAt && <button onClick={() => isWon ? setViewWonQuoteId(quote.id) : setEditing({ mode: 'edit', quote })} className="btn-primary flex-1 text-xs">
                    {isWon ? '查看成交版本' : '✏️ 開啟／輸出圖片'}
                  </button>}
                  {!quote.archivedAt && linkedCase && (!linkedDeal || !linkedDeal.quoteId) && <button type="button" onClick={() => { setDealError(''); setConfirmDealId(quote.id); }} className="btn-outline min-h-11 text-xs">{linkedDeal ? '核對成交報價' : '確認此報價成交'}</button>}
                  {!quote.archivedAt && linked && onOpenClient && (
                    <button onClick={() => onOpenClient(linked.id)} className="btn-outline text-xs">看客戶</button>
                  )}
                  {quote.archivedAt ? (
                    <button onClick={() => restoreQuote(quote.id)} className="btn-primary flex-1 text-xs">↩ 恢復報價</button>
                  ) : isWon ? null : confirmDeleteId === quote.id ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => moveQuoteToTrash(quote.id)} className="btn-danger text-[10px]">確認放入垃圾車</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="btn-outline text-[10px]">取消</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(quote.id)} className="btn-ghost text-danger/70 px-2" title="放入垃圾車（可恢復）">🗑</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing && (
        <QuoteModal
          key={editing.quote?.id || 'new-quote'}
          clients={clients}
          client={clientMap.get(editing.clientId || editing.quote?.clientId)}
          quote={editing.mode === 'edit' ? editing.quote : null}
          initialCaseId={editing.caseId || ''}
          onSaveQuote={handleSave}
          onRequestConfirmDeal={(id) => { setDealError(''); setConfirmDealId(id); }}
          onClose={() => { setEditing(null); finishAndReturn(); }}
        />
      )}
      {confirmDealId && (() => {
        const quote = quoteDrafts.find((row) => row.id === confirmDealId);
        const priorDeal = quote ? dealByCase.get(linkedCaseFor(quote)?.id) : null;
        return quote ? <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 md:items-center"><div className="w-full max-w-md rounded-2xl border border-bdr bg-s1 p-5 shadow-panel"><h2 className="text-lg font-bold text-ink">{priorDeal ? '核對既有成交的報價' : '確認這張報價成交？'}</h2><p className="mt-2 text-sm text-ink-2">{quote.customerName}・{quote.model || '未填車型'}<br />報價 NT$ {formatMoney(quote.total)}</p>{priorDeal && <p className="mt-2 text-xs font-bold text-warn">既有成交價 NT$ {formatMoney(priorDeal.amount)} 將保留；若與報價不同，請到後台核對成本與利潤。</p>}<p className="mt-3 text-xs text-copper">只會使用這張報價的配件建立核對表；同案其他報價不計入。</p>{pendingCount(quote) > 0 && <p className="mt-2 text-xs font-bold text-warn">仍有 {pendingCount(quote)} 項待廠商確認，成交後須繼續追蹤。</p>}{dealError && <p role="alert" className="mt-2 text-sm text-danger">{dealError}</p>}<div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => setConfirmDealId(null)} className="btn-outline min-h-12">先不要</button><button type="button" onClick={confirmDeal} disabled={dealSaving} className="btn-primary min-h-12 disabled:opacity-50">{dealSaving ? '處理中…' : '確認成交'}</button></div></div></div> : null;
      })()}
      {viewWonQuoteId && (() => {
        const deal = deals.find((row) => row.quoteId === viewWonQuoteId && !row.caseArchivedAt);
        const snapshot = deal?.quoteSnapshot || quoteDrafts.find((row) => row.id === viewWonQuoteId);
        return snapshot ? <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 md:items-center"><div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-bdr bg-s1 p-5 shadow-panel"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-ink">已成交報價・固定版本</h2><button type="button" onClick={() => setViewWonQuoteId(null)} className="btn-outline min-h-11">關閉</button></div><p className="mt-2 text-sm text-ink-2">{snapshot.customerName}・{snapshot.model || '未填車型'}</p><div className="mt-3 space-y-2">{(snapshot.items || []).map((item) => <div key={item.id} className="flex justify-between gap-2 rounded-lg bg-s2 p-2 text-xs text-ink"><span>{item.name}{item.optionValue ? `・${item.optionValue}` : ''}{item.gift ? '（贈送）' : ''}</span><span className="shrink-0">{item.gift ? '贈送' : item.pending ? '待詢價' : `NT$ ${formatMoney(item.price)}`}</span></div>)}</div><p className="mt-4 text-right font-bold text-accent">成交價 NT$ {formatMoney(deal?.amount ?? snapshot.total)}</p></div></div> : null;
      })()}
    </div>
  );
}

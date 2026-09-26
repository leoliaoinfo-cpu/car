import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { findDuplicateClient, formatMoney, generateId } from '../../utils/crm';
import { addDays, today } from '../../utils/date';
import QuoteModal from './QuoteModal';

function pendingCount(quote) {
  return (quote?.items || []).filter((item) => item.pending).length;
}

function requirementPendingCount(quote) {
  return Array.isArray(quote?.pendingRequirements) ? quote.pendingRequirements.length : 0;
}

export default function QuoteWorkspace({ onOpenClient }) {
  const {
    clients, quoteDrafts, saveQuoteDraft, deleteQuoteDraft,
    savePricingRecord, saveClient, updateClient, cats, stages,
  } = useApp();
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [saveNotice, setSaveNotice] = useState(null);

  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...quoteDrafts]
      .sort((a, b) => (b.updatedAt || b.date || '').localeCompare(a.updatedAt || a.date || ''))
      .filter((quote) => {
        if (!needle) return true;
        const linked = clientMap.get(quote.clientId);
        return [quote.customerName, quote.customerPhone, quote.model, quote.requirements, linked?.name, linked?.phone]
          .some((value) => String(value || '').toLowerCase().includes(needle));
      });
  }, [quoteDrafts, query, clientMap]);

  async function handleSave(payload) {
    const { _pricingRecord, _customerMode, ...quotePayload } = payload;
    const previousQuote = quoteDrafts.find((row) => row.id === quotePayload.id);
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
          source: '獨立報價',
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
  }

  async function removeQuote(id) {
    await deleteQuoteDraft(id);
    setConfirmDeleteId(null);
  }

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-5 py-4 md:py-6 space-y-4">
      <section className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/15 to-s1 p-4 md:p-5 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-accent">QUOTATION WORKSPACE</p>
            <h1 className="text-xl md:text-2xl font-bold text-ink mt-1">🧾 獨立報價單</h1>
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
          placeholder="搜尋客戶、電話、車型或需求…" className="flex-1 text-sm" />
        <span className="text-xs text-ink-3 shrink-0">{rows.length} 張</span>
      </div>

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
          <h2 className="font-semibold text-ink mt-3">{query ? '找不到符合的報價' : '還沒有獨立報價'}</h2>
          <p className="text-sm text-ink-3 mt-1">{query ? '換個關鍵字試試看。' : '按「新報價」開始記錄第一張需求單。'}</p>
          {!query && <button onClick={() => setEditing({ mode: 'new' })} className="btn-primary mt-4">＋ 建立報價</button>}
        </section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((quote) => {
            const linked = clientMap.get(quote.clientId);
            const customer = quote.customerName || linked?.name || '未填客戶';
            const pending = pendingCount(quote);
            const pendingRequirements = requirementPendingCount(quote);
            return (
              <article key={quote.id} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-semibold text-ink truncate">{customer}</h2>
                      {linked && <span className="text-[10px] rounded-full bg-accent/10 text-accent border border-accent/30 px-2 py-0.5">已連結客戶</span>}
                      {pending > 0
                        ? <span className="text-[10px] rounded-full bg-warn/10 text-warn border border-warn/30 px-2 py-0.5">待廠商報價 {pending} 項</span>
                        : <span className="text-[10px] rounded-full bg-ok/10 text-ok border border-ok/30 px-2 py-0.5">價格已齊</span>}
                      {pendingRequirements > 0 && <span className="text-[10px] rounded-full bg-warn/10 text-warn border border-warn/30 px-2 py-0.5">需求待確認 {pendingRequirements} 項</span>}
                    </div>
                    <p className="text-xs text-ink-3 mt-1">{quote.model || '未填車型'}・{dayjs(quote.date).format('YYYY/MM/DD')}</p>
                  </div>
                  <p className="text-right shrink-0">
                    <span className="block text-[10px] text-ink-3">{pending > 0 ? '目前金額' : '專案價'}</span>
                    <strong className="text-accent">NT$ {formatMoney(quote.total)}</strong>
                  </p>
                </div>

                {quote.requirements && (
                  <p className="text-xs text-ink-2 bg-s2 rounded-lg px-3 py-2 line-clamp-3 whitespace-pre-wrap">{quote.requirements}</p>
                )}

                <div className="flex items-center gap-2">
                  <button onClick={() => setEditing({ mode: 'edit', quote })} className="btn-primary flex-1 text-xs">
                    ✏️ 開啟／輸出圖片
                  </button>
                  {linked && onOpenClient && (
                    <button onClick={() => onOpenClient(linked.id)} className="btn-outline text-xs">看客戶</button>
                  )}
                  {confirmDeleteId === quote.id ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => removeQuote(quote.id)} className="btn-danger text-[10px]">確定</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="btn-outline text-[10px]">取消</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(quote.id)} className="btn-ghost text-danger/60 px-2" title="刪除報價">🗑</button>
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
          quote={editing.mode === 'edit' ? editing.quote : null}
          onSaveQuote={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

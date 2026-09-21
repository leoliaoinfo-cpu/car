import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { formatMoney } from '../../utils/crm';
import QuoteModal from './QuoteModal';

function pendingCount(quote) {
  return (quote?.items || []).filter((item) => item.pending).length;
}

export default function QuoteWorkspace({ onOpenClient }) {
  const {
    clients, quoteDrafts, saveQuoteDraft, deleteQuoteDraft,
    savePricingRecord,
  } = useApp();
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

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
    const { _pricingRecord, ...quote } = payload;
    await saveQuoteDraft(quote);
    if (_pricingRecord) {
      await savePricingRecord({
        ..._pricingRecord,
        clientId: quote.clientId || null,
        quoteId: quote.id,
      });
    }
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
              先記客戶需求，再勾車型與配件；還要問廠商的項目標成「待報價」，價格確認後回來補上，最後輸出一張完整圖片傳 LINE。
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
            return (
              <article key={quote.id} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-semibold text-ink truncate">{customer}</h2>
                      {pending > 0
                        ? <span className="text-[10px] rounded-full bg-warn/10 text-warn border border-warn/30 px-2 py-0.5">待廠商報價 {pending} 項</span>
                        : <span className="text-[10px] rounded-full bg-ok/10 text-ok border border-ok/30 px-2 py-0.5">價格已齊</span>}
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

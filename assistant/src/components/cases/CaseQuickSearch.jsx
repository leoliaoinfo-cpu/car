import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context';
import { CASE_TYPE_LABEL, getCasePipelineStage, getCaseStatusLabel } from '../../utils/cases';

export default function CaseQuickSearch({ onClose, onOpenCase }) {
  const { cases, clients, deals, quoteDrafts } = useApp();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const numericNeedle = needle.replace(/^#/, '');
    return cases.map((caseItem) => {
      const client = clients.find((item) => item.id === caseItem.clientId);
      const linkedDeal = deals.find((item) => item.id === caseItem.dealId || item.caseId === caseItem.id);
      const linkedQuotes = quoteDrafts.filter((item) => (caseItem.quoteIds || []).includes(item.id) || item.caseId === caseItem.id);
      const exactNumber = numericNeedle && String(caseItem.caseNumber) === numericNeedle;
      const values = [caseItem.caseNumber, `#${caseItem.caseNumber}`, caseItem.clientName, caseItem.title,
        client?.name, client?.phone, client?.lineId, client?.company, client?.plate, client?.licensePlate,
        linkedDeal?.model, ...linkedQuotes.map((item) => item.model)];
      return { caseItem, exactNumber, matches: !needle || values.some((value) => String(value || '').toLowerCase().includes(needle)) };
    }).filter((row) => row.matches)
      .sort((a, b) => Number(b.exactNumber) - Number(a.exactNumber)
        || String(b.caseItem.updatedAt || '').localeCompare(String(a.caseItem.updatedAt || '')))
      .slice(0, 30);
  }, [cases, clients, deals, query, quoteDrafts]);

  function open(item) {
    onOpenCase?.(item.id);
    onClose?.();
  }

  return (
    <div className="fixed inset-0 z-[90] bg-bg/98 backdrop-blur-sm md:flex md:items-start md:justify-center md:p-8" role="dialog" aria-modal="true" aria-label="案件快速搜尋">
      <div className="safe-screen flex h-full w-full flex-col bg-bg md:h-auto md:max-h-[82dvh] md:max-w-2xl md:rounded-2xl md:border md:border-bdr md:shadow-panel">
        <header className="flex items-center gap-2 border-b border-bdr bg-s1 p-3 md:rounded-t-2xl">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">⌕</span>
            <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)}
              className="min-h-12 w-full pl-9 pr-3" placeholder="輸入 #100、姓名、電話、車牌或車型" aria-label="搜尋案件" />
          </div>
          <button type="button" onClick={onClose} className="btn-outline min-h-12 shrink-0 px-4">關閉</button>
        </header>
        <div className="flex-1 overflow-y-auto p-3">
          {!query.trim() && <p className="mb-2 px-1 text-xs font-semibold text-ink-3">最近更新的案件</p>}
          {rows.length === 0 ? <div className="py-16 text-center text-sm text-ink-3">找不到符合的案件</div> : (
            <div className="space-y-2">
              {rows.map(({ caseItem }) => {
                const stage = getCasePipelineStage(caseItem, { deals, quotes: quoteDrafts });
                return <button type="button" key={caseItem.id} onClick={() => open(caseItem)} className="card min-h-16 w-full p-3 text-left hover:border-teal/60 active:scale-[0.99]">
                  <div className="flex items-start gap-3">
                    <span className="rounded-lg bg-teal/12 px-2 py-1 font-mono text-sm font-bold text-teal">#{caseItem.caseNumber}</span>
                    <div className="min-w-0 flex-1"><p className="truncate font-bold text-ink">{caseItem.clientName || '未命名客戶'}</p><p className="mt-0.5 truncate text-xs text-ink-3">{CASE_TYPE_LABEL[caseItem.type] || '案件'}・{caseItem.title || '未命名案件'}</p></div>
                    <div className="shrink-0 text-right"><p className="text-xs font-bold text-copper">{stage}</p><p className="mt-1 text-[10px] text-ink-3">{getCaseStatusLabel(caseItem)}</p></div>
                  </div>
                </button>;
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { formatMoney, generateId } from '../../utils/crm';
import {
  applyPricingDiscountsToQuote, buildPricingRecord, normalizeCostCatalog, updatePricingCosts,
} from '../../utils/pricing';

export function CostCatalogPanel({ quotePresets, costCatalog, onSave, initialSearch = '' }) {
  const [draft, setDraft] = useState(() => normalizeCostCatalog(costCatalog));
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => { setDraft(normalizeCostCatalog(costCatalog)); }, [costCatalog]);
  useEffect(() => { if (initialSearch) setSearch(initialSearch); }, [initialSearch]);

  function setCost(section, id, value) {
    setDraft((current) => {
      const next = { ...current, [section]: { ...current[section] } };
      if (value === '') delete next[section][id];
      else next[section][id] = { cost: Math.max(0, Number(value) || 0) };
      return next;
    });
  }

  async function save() {
    await onSave({ ...draft, key: 'costCatalog', updatedAt: new Date().toISOString() });
    setMessage('✅ 成本設定已儲存；之後建立或重新編輯的報價會凍結新成本快照。');
  }

  const needle = search.trim().toLowerCase();
  const allModels = quotePresets.models || [];
  const allAddons = quotePresets.addons || [];
  const models = allModels.filter((row) => !needle || row.name.toLowerCase().includes(needle));
  const addons = allAddons.filter((row) => !needle || row.name.toLowerCase().includes(needle));
  const missingModelCount = allModels.filter((item) => draft.models?.[item.id]?.cost == null).length;
  const missingAddonCount = allAddons.filter((item) => draft.addons?.[item.id]?.cost == null).length;

  const row = (item, section) => {
    const cost = draft[section]?.[item.id]?.cost;
    const profit = cost == null ? null : (Number(item.price) || 0) - cost;
    return (
      <div key={item.id} className={`grid grid-cols-[minmax(0,1fr)_100px] md:grid-cols-[minmax(0,1fr)_110px_110px] gap-2 items-center px-3 py-2 border-b border-bdr/50 last:border-0 ${cost == null ? 'bg-warn/5' : ''}`}>
        <div className="min-w-0">
          <p className="text-xs text-ink truncate">{item.name}</p>
          <p className="text-[10px] text-ink-3">售價 NT$ {formatMoney(item.price)}</p>
        </div>
        <input type="number" min="0" value={cost ?? ''}
          onChange={(e) => setCost(section, item.id, e.target.value)}
          placeholder="未設定" className={`text-xs w-full ${cost == null ? 'border-warn/60' : ''}`} aria-label={`${item.name}成本`} />
        <div className="hidden md:block text-right">
          <p className="text-[10px] text-ink-3">售價－成本</p>
          <p className={`text-xs font-semibold ${profit == null ? 'text-ink-3' : profit < 0 ? 'text-danger' : 'text-ok'}`}>
            {profit == null ? '待設定' : `NT$ ${formatMoney(profit)}`}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div>
          <h2 className="font-bold text-ink">🔒 成本設定</h2>
          <p className="text-xs text-ink-3 mt-1 leading-relaxed">
            這些數字只會顯示在已解鎖的內部區域。留空代表尚未取得成本；填 0 代表確定零成本。
          </p>
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋車型或改裝配件…" className="w-full text-sm" />
        {(missingModelCount > 0 || missingAddonCount > 0) && (
          <p className="text-xs text-warn bg-warn/10 border border-warn/25 rounded-lg px-3 py-2">
            ⚠️ 尚有 {missingModelCount} 個車型、{missingAddonCount} 個配件未設定成本；使用到這些項目時，報價試算會提醒補填。
          </p>
        )}
      </div>

      <section className="card overflow-hidden">
        <div className="px-3 py-2.5 bg-s2 border-b border-bdr">
          <h3 className="font-semibold text-sm text-ink-2">🚙 車型成本</h3>
        </div>
        {models.map((item) => row(item, 'models'))}
        {models.length === 0 && <p className="text-center text-xs text-ink-3 py-6">沒有符合的車型</p>}
      </section>

      <section className="card overflow-hidden">
        <div className="px-3 py-2.5 bg-s2 border-b border-bdr">
          <h3 className="font-semibold text-sm text-ink-2">🚚 專屬改裝配件成本</h3>
        </div>
        {addons.map((item) => row(item, 'addons'))}
        {addons.length === 0 && <p className="text-center text-xs text-ink-3 py-6">沒有符合的配件</p>}
      </section>

      {message && <p className="text-xs text-ok bg-ok/10 rounded-lg px-3 py-2">{message}</p>}
      <button onClick={save} className="btn-primary w-full">儲存全部成本</button>
    </div>
  );
}

export function QuotePricingPanel({
  clients, quoteDrafts = [], pricingRecords, costCatalog,
  onSavePricing, onSaveQuote, onOpenCostSettings,
}) {
  const [editing, setEditing] = useState(null);
  const records = useMemo(() => new Map(pricingRecords.map((row) => [row.id, row])), [pricingRecords]);
  const quotes = useMemo(() => {
    const clientMap = new Map(clients.map((client) => [client.id, client]));
    const clientQuotes = clients.flatMap((client) => (client.quotes || []).map((quote) => ({ client, quote, source: 'client' })));
    const standaloneQuotes = quoteDrafts.map((quote) => ({
      client: clientMap.get(quote.clientId) || {
        id: quote.clientId || null,
        name: quote.customerName || '未填客戶',
      },
      quote,
      source: 'draft',
    }));
    return [...clientQuotes, ...standaloneQuotes]
      .sort((a, b) => (b.quote.date || '').localeCompare(a.quote.date || ''));
  }, [clients, quoteDrafts]);

  function refreshedRecord(client, quote) {
    const existing = records.get(`quote:${quote.id}`) || null;
    return buildPricingRecord({
      quote: { ...quote, clientId: client.id }, costCatalog, existing,
    });
  }

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <h2 className="font-bold text-ink">🧮 報價試算</h2>
        <p className="text-xs text-ink-3 mt-1">每次開啟都會自動帶入已設定的成本並加總；手動填過的實際成本會優先保留，缺漏項目會要求補填。</p>
      </div>
      <div className="card overflow-hidden">
        {quotes.length === 0 && <p className="text-center text-sm text-ink-3 py-10">尚無報價紀錄</p>}
        {quotes.map(({ client, quote, source }) => {
          const record = refreshedRecord(client, quote);
          return (
            <div key={quote.id} className="px-3 py-3 border-b border-bdr/60 last:border-0">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{client.name || '未命名客戶'}・{quote.model || '未填車型'}</p>
                  <p className="text-[11px] text-ink-3 mt-0.5">{dayjs(quote.date).format('YYYY/MM/DD')}・報價 NT$ {formatMoney(quote.total)}</p>
                  <PricingBadges record={record} />
                </div>
                <button onClick={() => setEditing({ record, quote, client, source })}
                  className="btn-outline text-xs shrink-0">查看／調整</button>
              </div>
            </div>
          );
        })}
      </div>
      {editing && (
        <PricingEditorModal record={editing.record} quote={editing.quote} onClose={() => setEditing(null)}
          onOpenCostSettings={onOpenCostSettings}
          onSave={async (record, quote) => {
            if (quote && onSaveQuote) await onSaveQuote({ quote, client: editing.client, source: editing.source });
            await onSavePricing(record);
            setEditing(null);
          }} />
      )}
    </div>
  );
}

export function PricingEditorModal({ record, quote = null, onSave, onClose, onOpenCostSettings }) {
  const [lineCosts, setLineCosts] = useState(() => Object.fromEntries(
    (record.lines || []).map((line) => [line.id, line.costKnown ? String(line.cost) : '']),
  ));
  const [lineDiscounts, setLineDiscounts] = useState(() => Object.fromEntries(
    (record.lines || []).map((line) => [line.id, line.pricingDiscount ? String(line.pricingDiscount) : '']),
  ));
  const [otherCosts, setOtherCosts] = useState(() => (record.otherCosts || []).map((row) => ({ ...row, amount: String(row.amount) })));

  const cleanLineCosts = Object.fromEntries(Object.entries(lineCosts)
    .filter(([, value]) => value !== '')
    .map(([id, value]) => [id, Math.max(0, Number(value) || 0)]));
  const cleanOtherCosts = otherCosts.filter((row) => row.name.trim() && Number(row.amount) >= 0)
    .map((row) => ({ ...row, name: row.name.trim(), amount: Math.max(0, Number(row.amount) || 0) }));
  const cleanLineDiscounts = Object.fromEntries(Object.entries(lineDiscounts)
    .map(([id, value]) => [id, Math.max(0, Number(value) || 0)]));
  const preview = updatePricingCosts(record, cleanLineCosts, cleanOtherCosts, quote ? cleanLineDiscounts : null);
  const updatedQuote = quote ? applyPricingDiscountsToQuote(quote, cleanLineDiscounts) : null;
  const missingLines = (preview.lines || []).filter((line) => !line.costKnown);
  const missingCatalogLines = missingLines.filter((line) => line.catalogId);

  function addOtherCost() {
    setOtherCosts((list) => [...list, { id: generateId('cost'), name: '其他成本', amount: '' }]);
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="bg-s1 rounded-2xl shadow-panel border border-bdr w-full max-w-lg p-5 anim-scale-in z-50 max-h-[88vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="font-bold text-lg text-ink">🔒 單車成本與利潤</h3>
              <p className="text-xs text-ink-3">{record.model || '未填車型'}・折後售價 NT$ {formatMoney(preview.saleTotal)}</p>
            </div>
            <button onClick={onClose} className="btn-ghost text-xl">✕</button>
          </div>

          <div className="space-y-2">
            {(record.lines || []).map((line) => {
              const lineCost = Object.prototype.hasOwnProperty.call(cleanLineCosts, line.id)
                ? cleanLineCosts[line.id]
                : null;
              const previewLine = preview.lines.find((item) => item.id === line.id) || line;
              const contribution = lineCost == null ? null : previewLine.netPrice - lineCost;
              return (
              <div key={line.id} className={`grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_220px] gap-2 items-center rounded-lg p-2.5 border ${lineCost == null ? 'bg-warn/5 border-warn/35' : 'bg-s2 border-transparent'}`}>
                <div className="min-w-0">
                  <p className="text-xs text-ink truncate">{line.name}</p>
                  <p className="text-[10px] text-ink-3">
                    原始售價 NT$ {formatMoney(line.salePrice)}・折後 NT$ {formatMoney(previewLine.netPrice)}
                  </p>
                  {line.baseDiscountTotal > 0 && <p className="text-[10px] text-ok">原有優惠 NT$ {formatMoney(line.baseDiscountTotal)}</p>}
                </div>
                <div className={`grid ${quote ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                  <label className="block">
                    <span className="block text-[9px] text-ink-3 mb-0.5">實際成本</span>
                    <input type="number" min="0" value={lineCosts[line.id] ?? ''}
                      onChange={(e) => setLineCosts((current) => ({ ...current, [line.id]: e.target.value }))}
                      placeholder="實際成本" className="text-xs w-full" />
                  </label>
                  {quote && (
                    <label className="block">
                      <span className="block text-[9px] text-ink-3 mb-0.5">優惠折扣</span>
                      <input type="number" min="0" max={Math.max(0, line.salePrice - (line.baseDiscountTotal || 0))}
                        value={lineDiscounts[line.id] ?? ''}
                        onChange={(e) => setLineDiscounts((current) => ({ ...current, [line.id]: e.target.value }))}
                        placeholder="折扣金額" className="text-xs w-full" />
                    </label>
                  )}
                  <p className={`text-[10px] text-right mt-0.5 ${quote ? 'col-span-2' : ''} ${contribution == null ? 'text-warn font-semibold' : contribution < 0 ? 'text-danger' : 'text-ok'}`}>
                    {contribution == null ? '⚠️ 未設定成本' : `利潤貢獻 ${contribution < 0 ? '−' : ''}${formatMoney(Math.abs(contribution))}`}
                  </p>
                </div>
              </div>
              );
            })}
          </div>

          <div className="mt-3 space-y-2">
            {otherCosts.map((row) => (
              <div key={row.id} className="flex gap-2">
                <input value={row.name} onChange={(e) => setOtherCosts((list) => list.map((item) => item.id === row.id ? { ...item, name: e.target.value } : item))}
                  className="flex-1 text-xs" placeholder="其他成本名稱" />
                <input type="number" min="0" value={row.amount}
                  onChange={(e) => setOtherCosts((list) => list.map((item) => item.id === row.id ? { ...item, amount: e.target.value } : item))}
                  className="w-28 text-xs" placeholder="金額" />
                <button onClick={() => setOtherCosts((list) => list.filter((item) => item.id !== row.id))} className="text-danger/50">✕</button>
              </div>
            ))}
            <button onClick={addOtherCost} className="btn-outline text-xs">＋ 其他成本</button>
          </div>

          <div className="card p-3 mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
            <Metric label="原始售價" value={preview.originalTotal} />
            <Metric label="單項優惠" value={preview.itemDiscountTotal} tone="ok" prefix="−" />
            <Metric label="整單優惠" value={preview.generalDiscountTotal} tone="ok" prefix="−" />
            <Metric label={preview.costComplete ? '總成本' : '已填成本小計'} value={preview.costComplete ? preview.costTotal : preview.knownCostTotal} />
            <Metric label={record.kind === 'deal' ? '實際利潤' : '預估利潤'} value={preview.profit} tone={preview.profit != null && preview.profit < 0 ? 'danger' : 'ok'} />
            <Metric label="距離成本尚有空間" value={preview.profit == null ? null : Math.max(0, preview.profit)} tone="accent" />
          </div>
          {missingLines.length > 0 && (
            <div className="mt-3 rounded-xl border border-warn/35 bg-warn/10 p-3 space-y-2">
              <p className="text-xs font-semibold text-warn">⚠️ 尚有 {missingLines.length} 個項目沒有成本，總成本與利潤暫不成立。</p>
              <div className="flex flex-wrap gap-1">
                {missingLines.map((line) => (
                  <span key={line.id} className="text-[10px] text-warn bg-s1 border border-warn/25 rounded-full px-2 py-0.5">{line.name}</span>
                ))}
              </div>
              {missingCatalogLines.length > 0 && onOpenCostSettings && (
                <button type="button" onClick={() => onOpenCostSettings(missingCatalogLines[0].name)}
                  className="btn-outline text-xs border-warn/50 text-warn">前往成本設定調整</button>
              )}
              {missingLines.length > missingCatalogLines.length && (
                <p className="text-[10px] text-ink-3">自行新增的項目請直接在上方「實際成本」欄填寫。</p>
              )}
            </div>
          )}
          {preview.belowCost && <p className="text-xs text-danger mt-2 font-semibold">⚠️ 此價格低於成本。</p>}

          <div className="flex gap-2 mt-4">
            <button onClick={onClose} className="btn-outline flex-1">取消</button>
            <button onClick={() => onSave(preview, updatedQuote)} className="btn-primary flex-1">
              {quote ? '儲存成本與折扣' : '儲存成本'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function PricingBadges({ record }) {
  if (!record?.costComplete) return <span className="inline-block text-[10px] text-warn bg-warn/10 rounded-full px-2 py-0.5 mt-1">成本未完整</span>;
  return (
    <div className="flex gap-1.5 flex-wrap mt-1">
      <span className="text-[10px] text-ink-2 bg-s2 rounded-full px-2 py-0.5">成本 {formatMoney(record.costTotal)}</span>
      <span className={`text-[10px] rounded-full px-2 py-0.5 ${record.profit < 0 ? 'text-danger bg-danger/10' : 'text-ok bg-ok/10'}`}>
        利潤 {record.profit < 0 ? '−' : ''}{formatMoney(Math.abs(record.profit))}
      </span>
    </div>
  );
}

function Metric({ label, value, tone = 'ink', prefix = '' }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : tone === 'accent' ? 'text-accent' : 'text-ink';
  return (
    <div>
      <p className="text-[10px] text-ink-3">{label}</p>
      <p className={`text-sm font-bold ${value == null ? 'text-ink-3' : color}`}>
        {value == null ? '待補成本' : `NT$ ${prefix}${formatMoney(value)}`}
      </p>
    </div>
  );
}

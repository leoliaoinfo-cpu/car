import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { formatMoney, generateId } from '../../utils/crm';
import {
  applicableSupplierCosts, appendCustomItemHistory, applyPricingDiscountsToQuote, buildPricingRecord,
  normalizeCostCatalog, normalizeCustomItemHistory, normalizeDiscount, replaceBackendCustomQuoteItems, resolveAddonCost,
  sharedAddonCostId, updatePricingCosts,
} from '../../utils/pricing';

export function CostCatalogPanel({ quotePresets, costCatalog, onSave, initialSearch = '' }) {
  const [draft, setDraft] = useState(() => normalizeCostCatalog(costCatalog));
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [expandedAddon, setExpandedAddon] = useState(null);
  const [expandedCostCategories, setExpandedCostCategories] = useState(() => new Set());
  const [missingOnly, setMissingOnly] = useState(false);
  const [missingPanelOpen, setMissingPanelOpen] = useState(true);

  useEffect(() => { setDraft(normalizeCostCatalog(costCatalog)); }, [costCatalog]);
  useEffect(() => { if (initialSearch) setSearch(initialSearch); }, [initialSearch]);

  function setCost(section, id, value) {
    const targetId = section === 'addons' ? sharedAddonCostId(id) : id;
    setDraft((current) => {
      const next = { ...current, [section]: { ...current[section] } };
      const entry = { ...(next[section][targetId] || {}) };
      const key = section === 'models' ? 'commission' : 'cost';
      if (value === '') delete entry[key];
      else entry[key] = Math.max(0, Number(value) || 0);
      if (section === 'models') delete entry.cost;
      if (Object.keys(entry).length) next[section][targetId] = entry;
      else delete next[section][targetId];
      return next;
    });
  }

  function changeSupplierCost(addonId, supplierCostId, patch) {
    const targetId = sharedAddonCostId(addonId);
    setDraft((current) => ({
      ...current,
      addons: {
        ...current.addons,
        [targetId]: {
          ...(current.addons[targetId] || {}),
          supplierCosts: (current.addons[targetId]?.supplierCosts || [])
            .map((row) => row.id === supplierCostId ? { ...row, ...patch } : row),
        },
      },
    }));
  }

  function addSupplierCost(addonId) {
    const targetId = sharedAddonCostId(addonId);
    setDraft((current) => ({
      ...current,
      addons: {
        ...current.addons,
        [targetId]: {
          ...(current.addons[targetId] || {}),
          supplierCosts: [
            ...(current.addons[targetId]?.supplierCosts || []),
            { id: generateId('supplier-cost'), supplier: '', modelId: '', cost: '' },
          ],
        },
      },
    }));
    setExpandedAddon(addonId);
  }

  function removeSupplierCost(addonId, supplierCostId) {
    const targetId = sharedAddonCostId(addonId);
    setDraft((current) => ({
      ...current,
      addons: {
        ...current.addons,
        [targetId]: {
          ...(current.addons[targetId] || {}),
          supplierCosts: (current.addons[targetId]?.supplierCosts || [])
            .filter((row) => row.id !== supplierCostId),
        },
      },
    }));
  }

  async function save() {
    const incomplete = Object.values(draft.addons || {}).some((entry) => (entry?.supplierCosts || [])
      .some((row) => !String(row.supplier || '').trim() || row.cost === '' || row.cost == null
        || !Number.isFinite(Number(row.cost)) || Number(row.cost) < 0));
    if (incomplete) {
      setMessage('⚠️ 供應商成本有未填的廠商名稱或金額，請補齊後再儲存。');
      return;
    }
    const addons = Object.fromEntries(Object.entries(draft.addons || {}).map(([id, entry]) => [id, {
      ...entry,
      supplierCosts: (entry.supplierCosts || []).map((row) => ({
        ...row,
        supplier: String(row.supplier).trim(),
        modelId: row.modelId || '',
        cost: Math.max(0, Math.round(Number(row.cost))),
      })),
    }]));
    await onSave({ ...draft, addons, key: 'costCatalog', updatedAt: new Date().toISOString() });
    setMessage('✅ 傭金與成本設定已儲存；之後建立或重新編輯的報價會凍結新的試算快照。');
  }

  const needle = search.trim().toLowerCase();
  const allModels = quotePresets.models || [];
  const allAddons = quotePresets.addons || [];
  const isModelMissing = (item) => draft.models?.[item.id]?.commission == null;
  const isAddonMissing = (item) => {
    const entry = draft.addons?.[sharedAddonCostId(item.id)];
    return entry?.cost == null && !(entry?.supplierCosts || []).length;
  };
  const missingModels = allModels.filter(isModelMissing);
  const missingAddons = allAddons.filter(isAddonMissing);
  const missingModelCount = missingModels.length;
  const missingAddonCount = missingAddons.length;
  const missingTotal = missingModelCount + missingAddonCount;
  const models = allModels.filter((row) => (!missingOnly || isModelMissing(row))
    && (!needle || row.name.toLowerCase().includes(needle)))
    .sort((a, b) => Number(!isModelMissing(a)) - Number(!isModelMissing(b)));
  const addons = allAddons.filter((row) => (!missingOnly || isAddonMissing(row))
    && (!needle || row.name.toLowerCase().includes(needle)));
  const categoryOrder = quotePresets.addonCategories || [];
  const addonGroups = [...addons.reduce((groups, item) => {
    const category = item.cat || '其他';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
    return groups;
  }, new Map()).entries()].map(([category, list]) => ({
    category,
    missing: list.filter(isAddonMissing).length,
    rows: list.sort((a, b) => Number(isAddonMissing(b)) - Number(isAddonMissing(a))
      || (Number(b.price) || 0) - (Number(a.price) || 0)),
  })).sort((a, b) => Number(b.missing > 0) - Number(a.missing > 0)
    || (categoryOrder.indexOf(a.category) < 0 ? 999 : categoryOrder.indexOf(a.category))
      - (categoryOrder.indexOf(b.category) < 0 ? 999 : categoryOrder.indexOf(b.category)));

  function toggleCostCategory(category) {
    setExpandedCostCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function focusMissingItem(item, type) {
    setSearch(item.name);
    setMissingOnly(false);
    if (type === 'addon') setExpandedCostCategories(new Set([item.cat || '其他']));
  }

  const row = (item, section) => {
    const isVehicle = section === 'models';
    const costId = isVehicle ? item.id : sharedAddonCostId(item.id);
    const sharesTailgateCost = !isVehicle && costId !== item.id;
    const cost = isVehicle ? draft[section]?.[costId]?.commission : draft[section]?.[costId]?.cost;
    const profit = cost == null ? null : isVehicle ? cost : (Number(item.price) || 0) - cost;
    const supplierCosts = section === 'addons' ? (draft.addons?.[costId]?.supplierCosts || []) : [];
    return (
      <div key={item.id} className="border-b border-bdr/50 last:border-0">
        <div className={`grid grid-cols-[minmax(0,1fr)_100px] md:grid-cols-[minmax(0,1fr)_110px_110px] gap-2 items-center px-3 py-2 ${cost == null && !supplierCosts.length ? 'bg-warn/5' : ''}`}>
          <div className="min-w-0">
            <p className="text-xs text-ink truncate">{item.name}</p>
            <p className="text-[10px] text-ink-3">對外售價 NT$ {formatMoney(item.price)}</p>
            {sharesTailgateCost && <p className="text-[10px] text-accent">與同尺寸單折尾門共用成本</p>}
          </div>
          <input type="number" min="0" value={cost ?? ''}
            onChange={(e) => setCost(section, item.id, e.target.value)}
            placeholder={section === 'addons' ? '基本成本' : '每台傭金'}
            className={`text-xs w-full ${cost == null && !supplierCosts.length ? 'border-warn/60' : ''}`} aria-label={`${item.name}${isVehicle ? '傭金' : '成本'}`} />
          <div className="hidden md:block text-right">
            <p className="text-[10px] text-ink-3">{isVehicle ? '每台傭金' : '售價－基本成本'}</p>
            <p className={`text-xs font-semibold ${profit == null ? 'text-ink-3' : profit < 0 ? 'text-danger' : 'text-ok'}`}>
              {profit == null ? '待設定' : `NT$ ${formatMoney(profit)}`}
            </p>
          </div>
        </div>
        {section === 'addons' && (
          <div className="px-3 pb-2.5">
            <button type="button" onClick={() => setExpandedAddon(expandedAddon === item.id ? null : item.id)}
              className="text-[11px] text-accent font-medium">
              {expandedAddon === item.id ? '▼' : '▶'} 供應商／車型成本（{supplierCosts.length} 筆）
            </button>
            {expandedAddon === item.id && (
              <div className="mt-2 space-y-2 rounded-lg bg-s2/60 p-2.5">
                <p className="text-[10px] text-ink-3">有供應商資料時，依車型套用；未指定供應商先取適用的最高成本。基本成本保留作舊資料參考，不覆蓋已設定的供應商成本。</p>
                {supplierCosts.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-bdr/60 bg-s1 p-2 space-y-1">
                    <div className="grid grid-cols-[minmax(0,1fr)_88px_24px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_92px_24px] gap-1.5 items-center">
                      <input value={entry.supplier} onChange={(event) => changeSupplierCost(item.id, entry.id, { supplier: event.target.value })}
                        placeholder="供應商名稱" aria-label={`${item.name}供應商名稱`} className="text-xs min-w-0" />
                      <select value={entry.modelId || ''} onChange={(event) => changeSupplierCost(item.id, entry.id, { modelId: event.target.value })}
                        aria-label={`${item.name}適用車型`} className="text-xs min-w-0 col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto">
                        <option value="">全部車型</option>
                        {allModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                      </select>
                      <input type="number" min="0" value={entry.cost} onChange={(event) => changeSupplierCost(item.id, entry.id, { cost: event.target.value })}
                        placeholder="拿貨成本" aria-label={`${item.name}供應商成本`} className="text-xs min-w-0 col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto" />
                      <button type="button" onClick={() => removeSupplierCost(item.id, entry.id)} aria-label={`刪除${item.name}供應商成本`}
                        className="text-danger/70 text-sm col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto">✕</button>
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-[10px] text-ink-2 cursor-pointer">
                      <input type="checkbox" checked={!!entry.priority}
                        onChange={(event) => changeSupplierCost(item.id, entry.id, { priority: event.target.checked })} />
                      優先配合廠商
                    </label>
                    {entry.cost !== '' && entry.cost != null && (
                      <p className={`text-[10px] ${Number(item.price) < Number(entry.cost) ? 'text-danger font-semibold' : 'text-ink-3'}`}>
                        依目前選單售價估算：{Number(item.price) < Number(entry.cost) ? '⚠️ 售價低於成本，' : ''}利潤 NT$ {formatMoney((Number(item.price) || 0) - (Number(entry.cost) || 0))}
                      </p>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => addSupplierCost(item.id)} className="btn-outline text-[11px]">＋ 新增供應商價格</button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div>
          <h2 className="font-bold text-ink">🧮 傭金與成本設定</h2>
        </div>
        <div className="flex gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋車型或改裝配件…" className="w-full text-sm" />
          <button type="button" onClick={() => { setMissingOnly((value) => !value); setSearch(''); }}
            className={`btn-outline text-xs min-h-11 shrink-0 ${missingOnly ? 'border-warn bg-warn/10 text-warn' : ''}`}>
            {missingOnly ? '顯示全部' : `只看待補 ${missingTotal}`}
          </button>
        </div>
      </div>

      <section className={`rounded-xl border-2 ${missingTotal ? 'border-warn/35 bg-warn/5' : 'border-ok/25 bg-ok/5'} overflow-hidden`}>
        <button type="button" onClick={() => setMissingPanelOpen((open) => !open)}
          className="w-full p-3 flex items-center justify-between gap-3 text-left min-h-14">
          <div>
            <h3 className="text-sm font-bold text-ink">{missingTotal ? '⚠️ 待補成本工作區' : '✓ 成本資料已補齊'}</h3>
            <p className="text-[10px] text-ink-3 mt-0.5">
              {missingTotal ? `${missingModelCount} 個車型傭金・${missingAddonCount} 個配件成本尚未設定` : '目前車型傭金與配件成本都有資料'}
            </p>
          </div>
          <span className={`badge shrink-0 ${missingTotal ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok'}`}>
            {missingTotal} 項 {missingPanelOpen ? '▲' : '▼'}
          </span>
        </button>
        {missingPanelOpen && missingTotal > 0 && (
          <div className="border-t border-warn/20 p-3 space-y-3">
            <p className="text-[10px] text-ink-3">點一下項目會直接定位到對應設定，不必逐類尋找。</p>
            {missingModels.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-ink-2 mb-1.5">車型傭金（{missingModels.length}）</p>
                <div className="flex flex-wrap gap-1.5">
                  {missingModels.map((item) => (
                    <button type="button" key={item.id} onClick={() => focusMissingItem(item, 'model')}
                      className="rounded-full border border-warn/30 bg-s1 px-2.5 py-1.5 text-[11px] text-warn hover:bg-warn/10">
                      {item.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {missingAddons.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-ink-2 mb-1.5">配件成本（{missingAddons.length}）</p>
                <div className="max-h-52 overflow-y-auto flex flex-wrap content-start gap-1.5 pr-1">
                  {missingAddons.map((item) => (
                    <button type="button" key={item.id} onClick={() => focusMissingItem(item, 'addon')}
                      className="rounded-full border border-warn/30 bg-s1 px-2.5 py-1.5 text-[11px] text-warn hover:bg-warn/10">
                      {item.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="px-3 py-2.5 bg-s2 border-b border-bdr">
          <h3 className="font-semibold text-sm text-ink-2">🚙 車型每台傭金</h3>
        </div>
        {models.map((item) => row(item, 'models'))}
        {models.length === 0 && <p className="text-center text-xs text-ink-3 py-6">沒有符合的車型</p>}
      </section>

      <section className="card overflow-hidden">
        <div className="px-3 py-2.5 bg-s2 border-b border-bdr flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm text-ink-2">🚚 專屬改裝配件成本</h3>
            <p className="text-[10px] text-ink-3 mt-0.5">未填成本的分類與項目優先排列</p>
          </div>
          <div className="flex gap-1 shrink-0">
            <button type="button" onClick={() => setExpandedCostCategories(new Set(addonGroups.map((group) => group.category)))} className="btn-outline text-[10px] px-2">全部展開</button>
            <button type="button" onClick={() => setExpandedCostCategories(new Set())} className="btn-outline text-[10px] px-2">全部收合</button>
          </div>
        </div>
        {addonGroups.map((group) => {
          const open = !!needle || expandedCostCategories.has(group.category);
          return (
            <div key={group.category} className="border-b border-bdr/70 last:border-0">
              <button type="button" onClick={() => toggleCostCategory(group.category)}
                className="w-full px-3 py-3 flex items-center justify-between gap-3 bg-s1 hover:bg-s2 text-left">
                <span className="font-semibold text-sm text-ink">{open ? '▼' : '▶'} {group.category}</span>
                <span className={`text-[10px] rounded-full px-2 py-0.5 ${group.missing ? 'text-warn bg-warn/10' : 'text-ok bg-ok/10'}`}>
                  {group.missing ? `待補 ${group.missing}` : '已完成'}・{group.rows.length} 項
                </span>
              </button>
              {open && <div className="border-t border-bdr/50">{group.rows.map((item) => row(item, 'addons'))}</div>}
            </div>
          );
        })}
        {addons.length === 0 && <p className="text-center text-xs text-ink-3 py-6">沒有符合的配件</p>}
      </section>

      {message && <p className="text-xs text-ok bg-ok/10 rounded-lg px-3 py-2">{message}</p>}
      <button onClick={save} className="btn-primary w-full">儲存傭金與成本</button>
    </div>
  );
}

export function CustomPricingHistoryPanel({ entries = [], onSave }) {
  const [draft, setDraft] = useState(() => normalizeCustomItemHistory(entries));
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setDraft(normalizeCustomItemHistory(entries)); }, [entries]);

  const needle = search.trim().toLowerCase();
  const visibleRows = draft.filter((row) => !needle
    || [row.name, row.customerName, row.model].some((value) => String(value || '').toLowerCase().includes(needle)));
  const uniqueItemCount = new Set(draft.map((row) => row.name.trim().toLowerCase()).filter(Boolean)).size;

  function updateRow(id, patch) {
    setDraft((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
    setMessage('');
    setError('');
  }

  function addRow() {
    const now = new Date().toISOString();
    const sourceItemId = generateId('custom-template');
    const row = {
      id: `custom-history:central:${sourceItemId}:${now}`,
      sourceRecordId: 'central', sourceItemId, quoteId: null, clientId: null,
      customerName: '', model: '', name: '', salePrice: '', discount: '',
      netPrice: 0, cost: '', costKnown: false, profit: null, recordedAt: now,
    };
    setDraft((rows) => [row, ...rows]);
    setEditingId(row.id);
    setMessage('');
  }

  function removeRow(row) {
    if (!window.confirm(`確定刪除「${row.name || '這筆客製紀錄'}」？刪除後將無法從報價中帶入。`)) return;
    setDraft((rows) => rows.filter((item) => item.id !== row.id));
    if (editingId === row.id) setEditingId(null);
    setMessage('尚未儲存，請按下方「儲存中央客製資料」。');
  }

  async function save() {
    setError('');
    const incomplete = draft.some((row) => !String(row.name || '').trim()
      || row.salePrice === '' || Number(row.salePrice) <= 0);
    if (incomplete) {
      setError('請補齊每筆紀錄的項目名稱與當時售價；不需要的空白紀錄請刪除。');
      return;
    }
    const normalized = normalizeCustomItemHistory(draft.map((row) => ({
      ...row,
      salePrice: Math.max(0, Number(row.salePrice) || 0),
      discount: Math.max(0, Number(row.discount) || 0),
      cost: row.cost === '' || row.cost == null ? null : Math.max(0, Number(row.cost) || 0),
      costKnown: row.cost !== '' && row.cost != null,
    })));
    await onSave(normalized);
    setDraft(normalized);
    setEditingId(null);
    setMessage('✅ 中央客製資料已儲存，所有報價都會使用這份價格庫。');
  }

  return (
    <div className="space-y-4">
      <section className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-ink">🗃️ 客製價格庫</h2>
            <p className="text-xs text-ink-3 mt-1">集中管理過去客製項目的售價、成本與優惠；建立報價時可直接搜尋帶入。</p>
          </div>
          <button type="button" onClick={addRow} className="btn-primary text-xs min-h-11 shrink-0">＋ 新增紀錄</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-s2 p-2.5"><p className="text-[10px] text-ink-3">歷史價格</p><p className="text-lg font-bold text-accent">{draft.length} 筆</p></div>
          <div className="rounded-lg bg-s2 p-2.5"><p className="text-[10px] text-ink-3">客製項目</p><p className="text-lg font-bold text-ink">{uniqueItemCount} 種</p></div>
        </div>
        <input value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder="搜尋客製項目、客戶或車型…" className="w-full text-sm min-h-11" />
      </section>

      <section className="card overflow-hidden">
        {visibleRows.length === 0 && (
          <p className="text-center text-sm text-ink-3 py-10">{draft.length ? '找不到符合的客製紀錄' : '尚無客製價格，新增或從報價儲存後會出現在這裡。'}</p>
        )}
        {visibleRows.map((row) => {
          const salePrice = Math.max(0, Number(row.salePrice) || 0);
          const discount = Math.min(salePrice, Math.max(0, Number(row.discount) || 0));
          const netPrice = Math.max(0, salePrice - discount);
          const costKnown = row.cost !== '' && row.cost != null && row.costKnown !== false;
          const profit = costKnown ? netPrice - (Number(row.cost) || 0) : null;
          const editing = editingId === row.id;
          return (
            <article key={row.id} className="border-b border-bdr/60 last:border-0 p-3 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink break-words">{row.name || '未命名客製項目'}</p>
                  <p className="text-[10px] text-ink-3 mt-0.5">
                    {row.recordedAt ? dayjs(row.recordedAt).format('YYYY/MM/DD') : '日期未記錄'}
                    {row.customerName ? `・${row.customerName}` : ''}{row.model ? `・${row.model}` : ''}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={() => setEditingId(editing ? null : row.id)} className="btn-outline text-[11px] min-h-11">{editing ? '收合' : '調整'}</button>
                  <button type="button" onClick={() => removeRow(row)} className="min-h-11 min-w-11 rounded-lg border border-danger/25 text-danger" aria-label={`刪除${row.name || '客製紀錄'}`}>✕</button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px]">
                <span className="text-ink-3">售價 <strong className="block text-ink text-xs">NT$ {formatMoney(salePrice)}</strong></span>
                <span className="text-ink-3">優惠 <strong className="block text-ok text-xs">− {formatMoney(discount)}</strong></span>
                <span className="text-ink-3">折後 <strong className="block text-accent text-xs">NT$ {formatMoney(netPrice)}</strong></span>
                <span className="text-ink-3">成本 <strong className="block text-ink text-xs">{costKnown ? `NT$ ${formatMoney(row.cost)}` : '未記錄'}</strong></span>
                <span className="text-ink-3">利潤 <strong className={`block text-xs ${profit == null ? 'text-ink-3' : profit < 0 ? 'text-danger' : 'text-ok'}`}>{profit == null ? '未記錄' : `NT$ ${profit < 0 ? '−' : ''}${formatMoney(Math.abs(profit))}`}</strong></span>
              </div>
              {editing && (
                <div className="rounded-xl border border-accent/25 bg-accent/5 p-3 space-y-2">
                  <input value={row.name} onChange={(event) => updateRow(row.id, { name: event.target.value })}
                    placeholder="客製項目名稱" aria-label="中央客製項目名稱" className="w-full text-xs" />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[9px] text-ink-3">當時售價<input type="number" inputMode="numeric" min="0" value={row.salePrice}
                      onChange={(event) => updateRow(row.id, { salePrice: event.target.value })} className="mt-0.5 w-full text-xs" /></label>
                    <label className="text-[9px] text-ink-3">當時優惠<input type="number" inputMode="numeric" min="0" value={row.discount}
                      onChange={(event) => updateRow(row.id, { discount: event.target.value })} className="mt-0.5 w-full text-xs" /></label>
                    <label className="text-[9px] text-ink-3">當時成本<input type="number" inputMode="numeric" min="0" value={row.cost ?? ''}
                      onChange={(event) => updateRow(row.id, { cost: event.target.value, costKnown: event.target.value !== '' })} placeholder="可暫時空白" className="mt-0.5 w-full text-xs" /></label>
                    <label className="text-[9px] text-ink-3">紀錄日期<input type="date" value={row.recordedAt ? dayjs(row.recordedAt).format('YYYY-MM-DD') : ''}
                      onChange={(event) => updateRow(row.id, { recordedAt: event.target.value ? `${event.target.value}T00:00:00.000Z` : '' })} className="mt-0.5 w-full text-xs" /></label>
                    <label className="text-[9px] text-ink-3">客戶／來源<input value={row.customerName || ''}
                      onChange={(event) => updateRow(row.id, { customerName: event.target.value })} placeholder="選填" className="mt-0.5 w-full text-xs" /></label>
                    <label className="text-[9px] text-ink-3">車型<input value={row.model || ''}
                      onChange={(event) => updateRow(row.id, { model: event.target.value })} placeholder="選填" className="mt-0.5 w-full text-xs" /></label>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>
      {error && <p role="alert" className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">⚠️ {error}</p>}
      {message && <p role="status" className="text-xs text-ok bg-ok/10 rounded-lg px-3 py-2">{message}</p>}
      <button type="button" onClick={save} className="btn-primary w-full min-h-11">儲存中央客製資料</button>
    </div>
  );
}

export function QuotePricingPanel({
  clients, quoteDrafts = [], pricingRecords, costCatalog, customPricingHistory = [],
  onSavePricing, onSaveQuote, onSaveCustomHistory, onOpenCostSettings,
}) {
  const [editing, setEditing] = useState(null);
  const records = useMemo(() => new Map(pricingRecords.map((row) => [row.id, row])), [pricingRecords]);
  const customHistory = useMemo(() => {
    const clientNames = new Map(clients.map((client) => [client.id, client.name || '']));
    return normalizeCustomItemHistory(customPricingHistory).map((row) => ({
      ...row,
      customerName: row.customerName || clientNames.get(row.clientId) || '',
    }));
  }, [clients, customPricingHistory, pricingRecords]);
  const quotes = useMemo(() => {
    const clientMap = new Map(clients.map((client) => [client.id, client]));
    return quoteDrafts.map((quote) => ({
      client: clientMap.get(quote.clientId) || {
        id: quote.clientId || null,
        name: quote.customerName || '未填客戶',
      },
      quote,
      source: 'draft',
    })).sort((a, b) => (b.quote.updatedAt || b.quote.date || '').localeCompare(a.quote.updatedAt || a.quote.date || ''));
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
        <h2 className="font-bold text-ink">🧮 報價利潤試算</h2>
        <p className="text-xs text-ink-3 mt-1">車輛利潤直接帶入每台傭金；配件依供應商實際成本計算，尚未選供應商時先用適用的最高成本保守估算。</p>
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
        <PricingEditorModal record={editing.record} quote={editing.quote} costCatalog={costCatalog}
          customHistory={customHistory} customerName={editing.client.name || ''} onClose={() => setEditing(null)}
          onOpenCostSettings={onOpenCostSettings}
          onSave={async (record, quote, history) => {
            if (quote && onSaveQuote) await onSaveQuote({ quote, client: editing.client, source: editing.source });
            await onSavePricing(record);
            if (onSaveCustomHistory) await onSaveCustomHistory(history);
            setEditing(null);
          }} />
      )}
    </div>
  );
}

export function PricingEditorModal({
  record, quote = null, costCatalog = null, customHistory = [], customerName = '',
  onSave, onClose, onOpenCostSettings,
}) {
  const [lineCosts, setLineCosts] = useState(() => Object.fromEntries(
    (record.lines || []).map((line) => [line.id, line.costKnown ? String(line.cost) : '']),
  ));
  const [lineCostSources, setLineCostSources] = useState(() => ({ ...(record.lineCostSources || {}) }));
  const [supplierSelections, setSupplierSelections] = useState(() => ({ ...(record.supplierSelections || {}) }));
  const [lineDiscounts, setLineDiscounts] = useState(() => Object.fromEntries(
    (record.lines || []).map((line) => {
      const total = Math.max(0, Number(line.salePrice || 0) - Number(line.netPrice || 0));
      return [line.id, total ? String(total) : ''];
    }),
  ));
  const [lineGifts, setLineGifts] = useState(() => Object.fromEntries(
    (quote?.items || []).map((item) => [item.id, !!item.gift]),
  ));
  const [otherCosts, setOtherCosts] = useState(() => (record.otherCosts || []).map((row) => ({ ...row, amount: String(row.amount) })));
  const [customItems, setCustomItems] = useState(() => (record.lines || [])
    .filter((line) => line.backendCustom)
    .map((line) => ({
      id: line.id,
      name: line.name || '',
      salePrice: line.salePrice == null ? '' : String(line.salePrice),
      cost: line.costKnown ? String(line.cost) : '',
      discount: Math.max(0, Number(line.salePrice || 0) - Number(line.netPrice || 0)) || '',
    })));
  const [customError, setCustomError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyMessage, setHistoryMessage] = useState('');
  const [generalDiscounts, setGeneralDiscounts] = useState(() => (
    (record.generalDiscounts?.length ? record.generalDiscounts : quote?.generalDiscounts || [])
      .map((row) => {
        const normalized = normalizeDiscount(row);
        return {
          ...normalized,
          id: normalized.id || generateId('discount'),
          amount: normalized.amount ? String(normalized.amount) : '',
        };
      })
  ));
  const [discountError, setDiscountError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const customLineIds = new Set([
    ...(record.lines || []).filter((line) => line.backendCustom).map((line) => line.id),
    ...customItems.map((row) => row.id),
  ]);
  const regularLines = (record.lines || []).filter((line) => !line.backendCustom);
  const customLines = customItems.map((row) => {
    const salePrice = Math.max(0, Number(row.salePrice) || 0);
    return {
      id: row.id,
      catalogId: null,
      kind: 'addon',
      name: row.name.trim() || '未命名客製項目',
      gift: false,
      salePrice,
      netPrice: salePrice,
      discounts: [],
      baseDiscountTotal: 0,
      pricingDiscount: 0,
      cost: row.cost === '' ? null : Math.max(0, Number(row.cost) || 0),
      costKnown: row.cost !== '',
      costSource: 'manual',
      valueType: 'cost',
      supplierId: null,
      supplierName: null,
      backendCustom: true,
    };
  });
  const cleanLineCosts = {
    ...Object.fromEntries(Object.entries(lineCosts)
      .filter(([id, value]) => !customLineIds.has(id) && value !== '')
      .map(([id, value]) => [id, Math.max(0, Number(value) || 0)])),
    ...Object.fromEntries(customItems
      .filter((row) => row.cost !== '')
      .map((row) => [row.id, Math.max(0, Number(row.cost) || 0)])),
  };
  const cleanOtherCosts = otherCosts.filter((row) => row.name.trim() && Number(row.amount) >= 0)
    .map((row) => ({ ...row, name: row.name.trim(), amount: Math.max(0, Number(row.amount) || 0) }));
  const cleanLineDiscounts = {
    ...Object.fromEntries(Object.entries(lineDiscounts)
      .filter(([id]) => !customLineIds.has(id))
      .map(([id, value]) => [id, Math.max(0, Number(value) || 0)])),
    ...Object.fromEntries(customItems.map((row) => [
      row.id,
      Math.min(Math.max(0, Number(row.salePrice) || 0), Math.max(0, Number(row.discount) || 0)),
    ])),
  };
  const cleanGeneralDiscounts = generalDiscounts
    .filter((row) => row.name.trim() && Number(row.amount) > 0)
    .map((row) => ({
      id: row.id,
      name: row.name.trim(),
      amount: Math.max(0, Number(row.amount) || 0),
      funding: row.funding === 'sales' ? 'sales' : 'company',
    }));
  const generalDiscountTotal = cleanGeneralDiscounts
    .reduce((sum, row) => sum + row.amount, 0);
  const profitDiscountTotal = cleanGeneralDiscounts
    .filter((row) => row.funding === 'sales')
    .reduce((sum, row) => sum + row.amount, 0);
  const previewBase = {
    ...record,
    generalDiscounts: cleanGeneralDiscounts,
    generalDiscountTotal,
    profitDiscountTotal,
    companyFundedDiscountTotal: Math.max(0, generalDiscountTotal - profitDiscountTotal),
    lineCostSources: {
      ...lineCostSources,
      ...Object.fromEntries(customItems.map((row) => [row.id, 'manual'])),
    },
    supplierSelections,
    lines: [...regularLines, ...customLines].map((line) => ({
      ...line,
      gift: quote ? !!lineGifts[line.id] : !!line.gift,
      supplierName: applicableSupplierCosts(costCatalog, line.catalogId, record.modelId)
        .find((option) => option.id === supplierSelections[line.id])?.supplier || null,
    })),
  };
  const preview = updatePricingCosts(previewBase, cleanLineCosts, cleanOtherCosts, quote ? cleanLineDiscounts : null);
  const customQuote = quote ? replaceBackendCustomQuoteItems({
    ...quote,
    generalDiscounts: cleanGeneralDiscounts,
  }, customItems) : null;
  const updatedQuote = customQuote
    ? applyPricingDiscountsToQuote(customQuote, cleanLineDiscounts, lineGifts) : null;
  const payableBeforeCentralDiscount = Math.max(0, preview.originalTotal - preview.itemDiscountTotal);
  const centralDiscountTooHigh = !!quote && generalDiscountTotal > payableBeforeCentralDiscount;
  const missingLines = (preview.lines || []).filter((line) => !line.costKnown);
  const missingCatalogLines = missingLines.filter((line) => line.catalogId);
  const historyNeedle = historySearch.trim().toLowerCase();
  const filteredCustomHistory = customHistory.filter((row) => !historyNeedle
    || [row.name, row.customerName, row.model].some((value) => String(value || '').toLowerCase().includes(historyNeedle)));

  function addOtherCost() {
    setOtherCosts((list) => [...list, { id: generateId('cost'), name: '其他成本', amount: '' }]);
  }

  function addCustomItem() {
    setCustomItems((list) => [...list, {
      id: generateId('qi'), name: '', salePrice: '', cost: '', discount: '',
    }]);
    setCustomError('');
  }

  function updateCustomItem(id, patch) {
    setCustomItems((list) => list.map((row) => row.id === id ? { ...row, ...patch } : row));
    setCustomError('');
  }

  function reuseCustomHistory(row) {
    setCustomItems((list) => [...list, {
      id: generateId('qi'),
      name: row.name,
      salePrice: String(row.salePrice),
      cost: row.costKnown ? String(row.cost) : '',
      discount: row.discount ? String(row.discount) : '',
    }]);
    setCustomError('');
    setHistoryMessage(`已帶入「${row.name}」，請依本次需求確認售價與成本。`);
    setHistoryOpen(false);
  }

  function addGeneralDiscount() {
    setGeneralDiscounts((list) => [...list, {
      id: generateId('discount'), name: '專案優惠', amount: '', funding: 'company',
    }]);
    setDiscountError('');
  }

  function updateGeneralDiscount(id, patch) {
    setGeneralDiscounts((list) => list.map((row) => row.id === id ? { ...row, ...patch } : row));
    setDiscountError('');
  }

  function removeGeneralDiscount(row) {
    if (Number(row.amount) > 0
      && !window.confirm(`確定移除「${row.name || '中央優惠'}」？儲存後前台報價也會取消這筆優惠。`)) return;
    setGeneralDiscounts((list) => list.filter((item) => item.id !== row.id));
    setDiscountError('');
  }

  function selectSupplier(line, supplierId) {
    const selected = resolveAddonCost(costCatalog, line.catalogId, record.modelId, supplierId || null);
    setLineCosts((current) => ({ ...current, [line.id]: selected.cost == null ? '' : String(selected.cost) }));
    setLineCostSources((current) => ({ ...current, [line.id]: selected.source }));
    setSupplierSelections((current) => {
      const next = { ...current };
      if (selected.supplierId) next[line.id] = selected.supplierId;
      else delete next[line.id];
      return next;
    });
  }

  function editLineCost(line, value) {
    setLineCosts((current) => ({ ...current, [line.id]: value }));
    setLineCostSources((current) => ({ ...current, [line.id]: line.kind === 'vehicle' ? 'commission-manual' : 'manual' }));
    setSupplierSelections((current) => {
      const next = { ...current };
      delete next[line.id];
      return next;
    });
  }

  function toggleGift(line) {
    const nextGift = !lineGifts[line.id];
    setLineGifts((current) => ({ ...current, [line.id]: nextGift }));
    setLineDiscounts((current) => ({
      ...current,
      [line.id]: nextGift ? String(line.salePrice || 0) : '',
    }));
  }

  async function saveInternalPricing() {
    setSaveError('');
    const incompleteCustom = customItems.some((row) => !row.name.trim()
      || row.salePrice === '' || Number(row.salePrice) <= 0
      || row.cost === '' || Number(row.cost) < 0);
    if (incompleteCustom) {
      setCustomError('請補齊每個客製項目的名稱、對客售價與內部成本；不需要的空白列請刪除。');
      return;
    }
    const incompleteDiscount = quote
      && generalDiscounts.some((row) => !row.name.trim() || Number(row.amount) <= 0);
    if (incompleteDiscount) {
      setDiscountError('請補齊每筆中央優惠的名稱與金額；不需要的空白列請刪除。');
      return;
    }
    if (centralDiscountTooHigh) {
      setDiscountError(`中央優惠不可超過折扣前可收金額 NT$ ${formatMoney(payableBeforeCentralDiscount)}。`);
      return;
    }
    if (preview.belowCost && !window.confirm('⚠️ 此報價的優惠已超過車輛傭金與配件利潤，確定仍要儲存嗎？')) return;
    if (!preview.costComplete && preview.lines.length > 0
      && !window.confirm('⚠️ 傭金或成本尚未填齊，無法完成利潤安全檢查，確定仍要儲存嗎？')) return;
    setIsSaving(true);
    try {
      const savedAt = new Date().toISOString();
      const nextHistory = appendCustomItemHistory({
        ...preview,
        customItemHistory: customHistory,
      }, customItems, { customerName, recordedAt: savedAt });
      const pricingRecord = { ...preview };
      delete pricingRecord.customItemHistory;
      await onSave({ ...pricingRecord, updatedAt: savedAt }, updatedQuote, nextHistory);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '儲存失敗，請稍後再試。');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <div className="overlay" onClick={isSaving ? undefined : onClose} />
      <div className="modal">
        <div className="bg-s1 rounded-2xl shadow-panel border border-bdr w-full max-w-lg anim-scale-in z-50 max-h-[88vh] overflow-hidden flex flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-4">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="font-bold text-lg text-ink">🔒 單車利潤試算</h3>
              <p className="text-xs text-ink-3">{record.model || '未填車型'}・折後售價 NT$ {formatMoney(preview.saleTotal)}</p>
            </div>
            <button onClick={onClose} disabled={isSaving} className="btn-ghost text-xl" aria-label="關閉利潤試算">✕</button>
          </div>

          {quote && (
            <section className="rounded-xl border-2 border-ok/35 bg-ok/5 p-3 mb-3 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-ink">中央優惠</p>
                  <p className="text-[10px] text-ink-3 mt-0.5">整張報價的優惠，儲存後同步到前台報價。</p>
                </div>
                <button type="button" onClick={addGeneralDiscount}
                  className="btn-outline text-[11px] shrink-0 min-h-11">＋ 新增中央優惠</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-s1 border border-bdr p-2.5">
                  <p className="text-[9px] text-ink-3">整張優惠</p>
                  <p className="text-sm font-bold text-ok tabular-nums">− NT$ {formatMoney(generalDiscountTotal)}</p>
                </div>
                <div className="rounded-lg bg-s1 border border-bdr p-2.5">
                  <p className="text-[9px] text-ink-3">目前專案價</p>
                  <p className="text-sm font-bold text-accent tabular-nums">NT$ {formatMoney(preview.saleTotal)}</p>
                </div>
              </div>
              {generalDiscounts.map((row) => (
                <div key={row.id} className="rounded-lg border border-bdr bg-s1 p-2.5 space-y-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
                    <input value={row.name}
                      onChange={(e) => updateGeneralDiscount(row.id, { name: e.target.value })}
                      className="w-full text-xs" placeholder="優惠名稱，例如：公司優惠" aria-label="中央優惠名稱" />
                    <button type="button" onClick={() => removeGeneralDiscount(row)}
                      className="min-h-11 min-w-11 rounded-lg border border-danger/30 text-danger" aria-label={`刪除${row.name || '中央優惠'}`}>✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block min-w-0">
                      <span className="block text-[9px] text-ink-3 mb-0.5">優惠金額</span>
                      <input type="number" inputMode="numeric" min="0" max={payableBeforeCentralDiscount} value={row.amount}
                        onChange={(e) => updateGeneralDiscount(row.id, { amount: e.target.value })}
                        className="w-full text-xs" placeholder="折扣金額" />
                    </label>
                    <label className="block min-w-0">
                      <span className="block text-[9px] text-ink-3 mb-0.5">負擔來源</span>
                      <select value={row.funding || 'company'}
                        onChange={(e) => updateGeneralDiscount(row.id, { funding: e.target.value })}
                        className="w-full text-xs" aria-label={`${row.name || '中央優惠'}負擔來源`}>
                        <option value="company">公司／活動負擔</option>
                        <option value="sales">業務讓利（扣利潤）</option>
                      </select>
                    </label>
                  </div>
                </div>
              ))}
              {generalDiscounts.length === 0 && <p className="text-[11px] text-ink-3">尚未加入中央優惠。</p>}
              {centralDiscountTooHigh && (
                <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-2 text-[11px] text-danger font-semibold">
                  ⚠️ 中央優惠已超過折扣前可收金額 NT$ {formatMoney(payableBeforeCentralDiscount)}，請調低後再儲存。
                </p>
              )}
              {discountError && <p role="alert" className="text-[11px] text-danger font-semibold">⚠️ {discountError}</p>}
            </section>
          )}

          <div className="space-y-2">
            {regularLines.map((line) => {
              const supplierOptions = line.kind === 'addon'
                ? applicableSupplierCosts(costCatalog, line.catalogId, record.modelId).sort((a, b) => a.cost - b.cost) : [];
              const cheapestSupplier = supplierOptions[0] || null;
              const hasSupplierCosts = line.kind === 'addon'
                && (costCatalog?.addons?.[line.catalogId]?.supplierCosts || []).length > 0;
              const lineCost = Object.prototype.hasOwnProperty.call(cleanLineCosts, line.id)
                ? cleanLineCosts[line.id]
                : null;
              const previewLine = preview.lines.find((item) => item.id === line.id) || line;
              const contribution = lineCost == null ? null : line.kind === 'vehicle'
                ? lineCost
                : previewLine.netPrice - lineCost;
              return (
              <div key={line.id} className={`grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_220px] gap-2 items-center rounded-lg p-2.5 border ${lineCost == null ? 'bg-warn/5 border-warn/35' : 'bg-s2 border-transparent'}`}>
                <div className="min-w-0">
                  <p className="text-xs text-ink truncate">{line.name}</p>
                  <p className="text-[10px] text-ink-3">
                    原始售價 NT$ {formatMoney(line.salePrice)}・折後 NT$ {formatMoney(previewLine.netPrice)}
                  </p>
                  {hasSupplierCosts && (
                    <div className="mt-1 space-y-1">
                      {cheapestSupplier && (
                        <p className={`text-[10px] font-medium ${previewLine.netPrice < cheapestSupplier.cost ? 'text-warn' : 'text-ok'}`}>
                          僅依價格推薦：{cheapestSupplier.supplier}・成本 NT$ {formatMoney(cheapestSupplier.cost)}・此項折後利潤 NT$ {formatMoney(previewLine.netPrice - cheapestSupplier.cost)}
                        </p>
                      )}
                      <select value={supplierSelections[line.id] || ''}
                        onChange={(event) => selectSupplier(line, event.target.value)}
                        aria-label={`${line.name}指派供應商`} className="text-[11px] w-full">
                        <option value="">{lineCostSources[line.id] === 'manual' ? '手動成本・未指派廠商' : '未指派廠商・以最高適用成本估算'}</option>
                        {supplierOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.priority ? '★ 優先・' : ''}{option.id === cheapestSupplier?.id ? '最低成本・' : ''}{option.supplier}・成本 {formatMoney(option.cost)}・此項利潤 {formatMoney(previewLine.netPrice - option.cost)}
                          </option>
                        ))}
                      </select>
                      {supplierOptions.length === 0 && <p className="text-[10px] text-warn">⚠️ 此車型沒有適用的供應商成本，請到傭金與成本設定補上。</p>}
                      {!supplierSelections[line.id] && supplierOptions.length > 0 && lineCostSources[line.id] !== 'manual' && (
                        <p className="text-[10px] text-warn">未指派廠商，暫以最高成本 NT$ {formatMoney(Math.max(...supplierOptions.map((option) => option.cost)))} 試算；簽約後可在此指派。</p>
                      )}
                    </div>
                  )}
                </div>
                <div className={`grid ${quote ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                  <label className="block">
                    <span className="block text-[9px] text-ink-3 mb-0.5">{line.kind === 'vehicle' ? '每台傭金' : '配件成本'}</span>
                    <input type="number" min="0" value={lineCosts[line.id] ?? ''}
                      onChange={(e) => editLineCost(line, e.target.value)}
                      placeholder={line.kind === 'vehicle' ? '每台傭金' : '配件成本'} className="text-xs w-full" />
                  </label>
                  {quote && (
                    <label className="block">
                      <span className="block text-[9px] text-ink-3 mb-0.5">單項優惠（與報價同步）</span>
                      <input type="number" min="0" max={Math.max(0, line.salePrice)}
                        value={lineDiscounts[line.id] ?? ''}
                        onChange={(e) => {
                          setLineDiscounts((current) => ({ ...current, [line.id]: e.target.value }));
                          if (lineGifts[line.id]) setLineGifts((current) => ({ ...current, [line.id]: false }));
                        }}
                        placeholder="折扣金額" className="text-xs w-full" />
                    </label>
                  )}
                  {quote && line.kind !== 'vehicle' && (
                    <button type="button" onClick={() => toggleGift(line)}
                      className={`min-h-11 rounded-lg border px-3 text-xs font-semibold ${lineGifts[line.id] ? 'border-ok bg-ok/15 text-ok' : 'border-bdr text-ink-2 hover:bg-s3'} col-span-2`}>
                      {lineGifts[line.id] ? '✓ 此項已核定贈送' : '🎁 核定此項贈送'}
                    </button>
                  )}
                  <p className={`text-[10px] text-right mt-0.5 ${quote ? 'col-span-2' : ''} ${contribution == null ? 'text-warn font-semibold' : contribution < 0 ? 'text-danger' : 'text-ok'}`}>
                    {contribution == null ? `⚠️ 未設定${line.kind === 'vehicle' ? '傭金' : '成本'}` : `利潤貢獻 ${contribution < 0 ? '−' : ''}${formatMoney(Math.abs(contribution))}`}
                  </p>
                </div>
              </div>
              );
            })}
          </div>

          <div className="mt-3 space-y-2">
            {quote && (
              <section className="rounded-xl border border-accent/35 bg-accent/5 p-3 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-ink">＋ 額外客製化報價</p>
                    <p className="text-[10px] text-ink-3 mt-0.5">填入售價與成本後，即時計算此項利潤並留下歷史價格。</p>
                  </div>
                  <button type="button" onClick={() => setHistoryOpen((open) => !open)}
                    className={`btn-outline text-[11px] shrink-0 min-h-11 ${historyOpen ? 'border-accent text-accent bg-accent/10' : ''}`}>
                    🕘 歷史客製化 {customHistory.length > 0 ? `(${customHistory.length})` : ''}
                  </button>
                </div>
                {historyOpen && (
                  <div className="rounded-xl border border-bdr bg-s1 p-2.5 space-y-2">
                    <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)}
                      placeholder="搜尋客製項目、客戶或車型…" aria-label="搜尋歷史客製化"
                      className="w-full text-xs min-h-11" />
                    {filteredCustomHistory.length === 0 ? (
                      <p className="text-center text-[11px] text-ink-3 py-4">
                        {customHistory.length === 0 ? '尚無歷史客製紀錄；第一次儲存後會自動建立。' : '找不到符合的歷史客製紀錄。'}
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-72 overflow-y-auto">
                        {filteredCustomHistory.map((row) => (
                          <div key={row.id} className="rounded-lg border border-bdr bg-s2/50 p-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-ink break-words">{row.name}</p>
                                <p className="text-[9px] text-ink-3 mt-0.5">
                                  {row.recordedAt ? dayjs(row.recordedAt).format('YYYY/MM/DD HH:mm') : '日期未記錄'}
                                  {row.customerName ? `・${row.customerName}` : ''}{row.model ? `・${row.model}` : ''}
                                </p>
                              </div>
                              <button type="button" onClick={() => reuseCustomHistory(row)}
                                className="btn-primary text-[11px] min-h-11 shrink-0 px-3">帶入</button>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[10px]">
                              <span className="text-ink-3">當時售價 <strong className="text-ink">NT$ {formatMoney(row.salePrice)}</strong></span>
                              <span className="text-ink-3">當時成本 <strong className="text-ink">{row.costKnown ? `NT$ ${formatMoney(row.cost)}` : '未記錄'}</strong></span>
                              <span className="text-ink-3">當時優惠 <strong className="text-ok">− NT$ {formatMoney(row.discount)}</strong></span>
                              <span className="text-ink-3">折後售價 <strong className="text-accent">NT$ {formatMoney(row.netPrice)}</strong></span>
                              <span className="text-ink-3 col-span-2">當時利潤 <strong className={row.profit == null ? 'text-ink-3' : row.profit < 0 ? 'text-danger' : 'text-ok'}>
                                {row.profit == null ? '未記錄' : `${row.profit < 0 ? '− ' : ''}NT$ ${formatMoney(Math.abs(row.profit))}`}
                              </strong></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {historyMessage && <p role="status" className="text-[11px] text-ok font-semibold">✓ {historyMessage}</p>}
                {customItems.map((row) => {
                  const salePrice = Math.max(0, Number(row.salePrice) || 0);
                  const discount = Math.min(salePrice, Math.max(0, Number(row.discount) || 0));
                  const netPrice = Math.max(0, salePrice - discount);
                  const contribution = row.salePrice === '' || row.cost === ''
                    ? null : netPrice - (Number(row.cost) || 0);
                  return (
                    <div key={row.id} className="rounded-lg border border-bdr bg-s1 p-2.5 space-y-2">
                      <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
                        <input value={row.name} onChange={(e) => updateCustomItem(row.id, { name: e.target.value })}
                          className="w-full text-xs" placeholder="客製項目名稱，例如：加裝工具箱" aria-label="客製項目名稱" />
                        <button type="button" onClick={() => setCustomItems((list) => list.filter((item) => item.id !== row.id))}
                          className="min-h-11 min-w-11 rounded-lg border border-danger/30 text-danger" aria-label={`刪除${row.name || '客製項目'}`}>✕</button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-end">
                        <label className="block min-w-0">
                          <span className="block text-[9px] text-ink-3 mb-0.5">對客售價</span>
                          <input type="number" inputMode="numeric" min="0" value={row.salePrice}
                            onChange={(e) => updateCustomItem(row.id, { salePrice: e.target.value })}
                            className="w-full text-xs" placeholder="售價" />
                        </label>
                        <label className="block min-w-0">
                          <span className="block text-[9px] text-ink-3 mb-0.5">給客戶優惠</span>
                          <input type="number" inputMode="numeric" min="0" max={salePrice} value={row.discount}
                            onChange={(e) => updateCustomItem(row.id, { discount: e.target.value })}
                            className="w-full text-xs" placeholder="優惠金額" />
                        </label>
                        <label className="block min-w-0">
                          <span className="block text-[9px] text-ink-3 mb-0.5">內部成本</span>
                          <input type="number" inputMode="numeric" min="0" value={row.cost}
                            onChange={(e) => updateCustomItem(row.id, { cost: e.target.value })}
                            className="w-full text-xs" placeholder="成本" />
                        </label>
                        <div className="min-h-11 rounded-lg border border-bdr bg-s2 px-2.5 py-1.5">
                          <span className="block text-[9px] text-ink-3">折後售價</span>
                          <span className="block text-xs font-semibold text-ink tabular-nums">NT$ {formatMoney(netPrice)}</span>
                        </div>
                      </div>
                      <p className={`text-[10px] text-right ${contribution == null ? 'text-ink-3' : contribution < 0 ? 'text-danger' : 'text-ok'}`}>
                        {contribution == null ? '填入售價與成本後即時計算' : `此項利潤 ${contribution < 0 ? '−' : ''}${formatMoney(Math.abs(contribution))}`}
                      </p>
                    </div>
                  );
                })}
                {customError && <p role="alert" className="text-[11px] text-danger font-semibold">⚠️ {customError}</p>}
                <button type="button" onClick={addCustomItem} className="btn-outline text-xs w-full min-h-11">＋ 新增客製化項目</button>
              </section>
            )}
            <section className="rounded-xl border border-bdr bg-s2/40 p-3 space-y-2">
              <div>
                <p className="text-xs font-semibold text-ink-2">其他內部成本</p>
              </div>
              {otherCosts.map((row) => (
                <div key={row.id} className="flex gap-2">
                  <input value={row.name} onChange={(e) => setOtherCosts((list) => list.map((item) => item.id === row.id ? { ...item, name: e.target.value } : item))}
                    className="flex-1 text-xs" placeholder="其他成本名稱" />
                  <input type="number" min="0" value={row.amount}
                    onChange={(e) => setOtherCosts((list) => list.map((item) => item.id === row.id ? { ...item, amount: e.target.value } : item))}
                    className="w-28 text-xs" placeholder="金額" />
                  <button type="button" onClick={() => setOtherCosts((list) => list.filter((item) => item.id !== row.id))}
                    className="min-h-11 min-w-11 text-danger/70" aria-label={`刪除${row.name || '其他成本'}`}>✕</button>
                </div>
              ))}
              <button type="button" onClick={addOtherCost} className="btn-outline text-xs">＋ 其他成本</button>
            </section>
          </div>

          <div className="mt-4 rounded-xl border-2 border-accent/35 bg-accent/10 p-4">
            <p className="text-[11px] font-semibold text-accent">客戶優惠後報價</p>
            <p className="mt-1 text-2xl font-extrabold text-ink tabular-nums">
              NT$ {formatMoney(preview.saleTotal)}
            </p>
            <p className="mt-1 text-[10px] text-ink-3">
              原始售價 NT$ {formatMoney(preview.originalTotal)} − 價格折扣 NT$ {formatMoney(preview.discountTotal)}
              {preview.giftValueTotal > 0 ? `；另贈價值 NT$ ${formatMoney(preview.giftValueTotal)}` : ''}
            </p>
          </div>

          <div className="card p-3 mt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
            <Metric label="原始售價" value={preview.originalTotal} />
            <Metric label="單項優惠" value={preview.itemDiscountTotal} tone="ok" prefix="−" />
            <Metric label="公司／活動優惠" value={preview.companyFundedDiscountTotal} tone="ok" prefix="−" />
            <Metric label="業務讓利" value={preview.profitDiscountTotal} tone="ok" prefix="−" />
            <Metric label="贈品價值" value={preview.giftValueTotal} tone="ok" />
            <Metric label="總優惠（折扣＋贈品）" value={preview.customerBenefitTotal} tone="ok" />
            <Metric label="車輛傭金" value={preview.commissionTotal} tone="accent" />
            <Metric label="配件淨利（含贈品成本）" value={preview.accessoryProfitTotal} tone={preview.accessoryProfitTotal < 0 ? 'danger' : 'ok'} />
            <Metric label="其他實際成本" value={preview.otherCostTotal} prefix="−" />
            <Metric label={preview.costComplete ? '配件／其他成本' : '已填成本小計'} value={preview.costComplete ? preview.costTotal : preview.knownCostTotal} />
            <Metric label="目前試算利潤" value={preview.profit} tone={preview.profit != null && preview.profit < 0 ? 'danger' : 'ok'} />
          </div>
          {preview.costComplete && (
            <p className="mt-2 rounded-lg bg-s2 px-3 py-2 text-[11px] text-ink-2 leading-relaxed">
              利潤計算：車輛傭金 {formatMoney(preview.commissionTotal)} ＋ 配件淨利 {formatMoney(preview.accessoryProfitTotal)}
              {' '}− 業務讓利 {formatMoney(preview.profitDiscountTotal)} − 其他實際成本 {formatMoney(preview.otherCostTotal)}
              {' '}＝ {formatMoney(preview.profit)}
            </p>
          )}
          {missingLines.length > 0 && (
            <div className="mt-3 rounded-xl border border-warn/35 bg-warn/10 p-3 space-y-2">
              <p className="text-xs font-semibold text-warn">⚠️ 尚有 {missingLines.length} 個項目沒有傭金／成本，總利潤暫不成立。</p>
              <div className="flex flex-wrap gap-1">
                {missingLines.map((line) => (
                  <span key={line.id} className="text-[10px] text-warn bg-s1 border border-warn/25 rounded-full px-2 py-0.5">{line.name}</span>
                ))}
              </div>
              {missingCatalogLines.length > 0 && onOpenCostSettings && (
                <button type="button" onClick={() => onOpenCostSettings(missingCatalogLines[0].name)}
                  className="btn-outline text-xs border-warn/50 text-warn">前往傭金與成本設定</button>
              )}
              {missingLines.length > missingCatalogLines.length && (
                <p className="text-[10px] text-ink-3">自行新增的項目請直接在上方「配件成本」欄填寫。</p>
              )}
            </div>
          )}
          {preview.belowCost && <p className="text-xs text-danger mt-2 font-semibold">⚠️ 優惠已超過車輛傭金與配件利潤。</p>}
          {saveError && (
            <p role="alert" className="mt-2 rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs text-danger font-semibold">
              ⚠️ 儲存失敗：{saveError}
            </p>
          )}
          </div>

          <div className="flex shrink-0 gap-2 border-t border-bdr bg-s1 p-3">
            <button onClick={onClose} disabled={isSaving} className="btn-outline flex-1 min-h-11">取消</button>
            <button onClick={saveInternalPricing} disabled={isSaving || centralDiscountTooHigh}
              className="btn-primary flex-1 min-h-11">
              {isSaving ? '儲存中…' : quote ? '儲存試算與折扣' : '儲存利潤試算'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function PricingBadges({ record }) {
  if (!record?.costComplete) return <span className="inline-block text-[10px] text-warn bg-warn/10 rounded-full px-2 py-0.5 mt-1">傭金／成本未完整</span>;
  return (
    <div className="flex gap-1.5 flex-wrap mt-1">
      {record.commissionTotal > 0 && <span className="text-[10px] text-accent bg-accent/10 rounded-full px-2 py-0.5">車輛傭金 {formatMoney(record.commissionTotal)}</span>}
      <span className="text-[10px] text-ink-2 bg-s2 rounded-full px-2 py-0.5">配件／其他成本 {formatMoney(record.costTotal)}</span>
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

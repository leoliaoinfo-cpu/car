import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { FIELD_COLORS, formatMoney, sumDeals } from '../../utils/crm';
import { updatePricingCosts } from '../../utils/pricing';
import DealModal from './DealModal';
import {
  CostCatalogPanel,
  PricingBadges,
  PricingEditorModal,
  QuotePricingPanel,
} from './InternalPricing';

export default function DealsPage({ onOpenClient }) {
  const {
    deals,
    dealFields,
    clients,
    quotePresets,
    costCatalog,
    pricingRecords,
    saveDeal,
    deleteDeal,
    saveCostCatalog,
    savePricingRecord,
  } = useApp();
  const [section, setSection] = useState('performance');
  const [view, setView] = useState('month');
  const [monthKey, setMonthKey] = useState(dayjs().format('YYYY-MM'));
  const [editingDeal, setEditingDeal] = useState(null);
  const [editingPricing, setEditingPricing] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const sortedFields = useMemo(
    () => [...dealFields].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [dealFields],
  );
  const pricingById = useMemo(
    () => new Map(pricingRecords.map((record) => [record.id, record])),
    [pricingRecords],
  );
  const monthDeals = useMemo(
    () => deals
      .filter((deal) => (deal.date || '').slice(0, 7) === monthKey)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [deals, monthKey],
  );
  const allDealsByMonth = useMemo(() => {
    const groups = {};
    for (const deal of deals) {
      const key = (deal.date || '').slice(0, 7) || '未設定日期';
      (groups[key] = groups[key] || []).push(deal);
    }
    return Object.entries(groups)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, list]) => ({
        key,
        list: list.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
        totals: sumDeals(list, sortedFields),
      }));
  }, [deals, sortedFields]);

  const shownDeals = view === 'month' ? monthDeals : deals;
  const totals = useMemo(() => sumDeals(shownDeals, sortedFields), [shownDeals, sortedFields]);
  const profitSummary = useMemo(() => shownDeals.reduce((summary, deal) => {
    const record = pricingById.get(`deal:${deal.id}`);
    if (!record?.costComplete) return summary;
    summary.complete += 1;
    summary.cost += Number(record.costTotal) || 0;
    summary.profit += Number(record.profit) || 0;
    return summary;
  }, { complete: 0, cost: 0, profit: 0 }), [shownDeals, pricingById]);

  function shiftMonth(amount) {
    setMonthKey(dayjs(`${monthKey}-01`).add(amount, 'month').format('YYYY-MM'));
  }

  async function handleDelete(id) {
    await deleteDeal(id);
    setDeleteConfirmId(null);
  }

  async function handleSaveDeal(deal) {
    await saveDeal(deal);
    const record = pricingById.get(`deal:${deal.id}`);
    if (record) {
      await savePricingRecord(updatePricingCosts({
        ...record,
        saleTotal: Math.max(0, Number(deal.amount) || 0),
        updatedAt: new Date().toISOString(),
      }, record.lineCosts, record.otherCosts));
    }
    setEditingDeal(null);
  }

  function openDealPricing(deal) {
    const existing = pricingById.get(`deal:${deal.id}`);
    if (existing) {
      setEditingPricing(existing);
      return;
    }
    setEditingPricing(updatePricingCosts({
      id: `deal:${deal.id}`,
      kind: 'deal',
      dealId: deal.id,
      clientId: deal.clientId || null,
      quoteId: deal.quoteId || null,
      model: deal.model || deal.note || '歷史成交',
      originalTotal: Math.max(0, Number(deal.amount) || 0),
      itemDiscountTotal: 0,
      generalDiscountTotal: 0,
      discountTotal: 0,
      saleTotal: Math.max(0, Number(deal.amount) || 0),
      lines: [{
        id: 'historical-total',
        catalogId: null,
        kind: 'other',
        name: deal.model || deal.note || '歷史成交',
        salePrice: Math.max(0, Number(deal.amount) || 0),
        netPrice: Math.max(0, Number(deal.amount) || 0),
        discounts: [],
        cost: null,
        costKnown: false,
      }],
      lineCosts: {},
      otherCosts: [],
      createdAt: deal.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, {}, []));
  }

  const tabs = [
    ['performance', '業績與利潤'],
    ['quotes', '報價試算'],
    ['costs', '成本設定'],
  ];

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="card p-1 flex gap-1">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setSection(key)}
            className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold ${section === key ? 'bg-accent text-on-accent' : 'text-ink-2 hover:bg-s2'}`}>
            {label}
          </button>
        ))}
      </div>

      {section === 'quotes' && (
        <QuotePricingPanel clients={clients} pricingRecords={pricingRecords}
          costCatalog={costCatalog} onSavePricing={savePricingRecord} />
      )}

      {section === 'costs' && (
        <CostCatalogPanel quotePresets={quotePresets} costCatalog={costCatalog}
          onSave={saveCostCatalog} />
      )}

      {section === 'performance' && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-xl font-bold text-ink">📈 業績與單車利潤</h1>
              <p className="text-xs text-ink-3 mt-1">成本只在此密碼保護區顯示，不會進入客戶報價或分享圖片。</p>
            </div>
            <div className="flex rounded-lg border border-bdr overflow-hidden">
              <button onClick={() => setView('month')}
                className={`px-3 py-1.5 text-sm font-medium ${view === 'month' ? 'bg-accent text-on-accent' : 'text-ink-2 hover:bg-s2'}`}>
                本月
              </button>
              <button onClick={() => setView('all')}
                className={`px-3 py-1.5 text-sm font-medium ${view === 'all' ? 'bg-accent text-on-accent' : 'text-ink-2 hover:bg-s2'}`}>
                全部
              </button>
            </div>
          </div>

          {view === 'month' && (
            <div className="flex items-center justify-center gap-4">
              <button onClick={() => shiftMonth(-1)} className="btn-ghost text-lg px-3">‹</button>
              <span className="font-semibold text-ink min-w-32 text-center">
                {dayjs(`${monthKey}-01`).format('YYYY 年 M 月')}
              </span>
              <button onClick={() => shiftMonth(1)} className="btn-ghost text-lg px-3">›</button>
            </div>
          )}

          <div className="card p-4">
            <p className="text-xs text-ink-3 mb-2">
              {view === 'month' ? `${dayjs(`${monthKey}-01`).format('M 月')}成交` : '全部成交'}
              <strong className="text-ink ml-1">{totals.count} 筆</strong>
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryMetric label="成交金額" value={totals.amount} tone="accent" />
              <SummaryMetric label={`已補成本（${profitSummary.complete}/${totals.count}）`}
                value={profitSummary.complete ? profitSummary.cost : null} />
              <SummaryMetric label="已確認單車利潤合計"
                value={profitSummary.complete ? profitSummary.profit : null}
                tone={profitSummary.profit < 0 ? 'danger' : 'ok'} />
              {sortedFields.slice(0, 1).map((field) => (
                <div key={field.id}>
                  <p className="text-[11px] text-ink-3">{field.name}</p>
                  <p className="text-lg font-bold" style={{ color: FIELD_COLORS[field.colorIdx % FIELD_COLORS.length] }}>
                    NT$ {formatMoney(totals.fields[field.id])}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {view === 'month' ? (
            <div className="card overflow-hidden">
              {monthDeals.length === 0 && <EmptyDeals />}
              {monthDeals.map((deal) => (
                <DealRow key={deal.id} deal={deal} fields={sortedFields}
                  pricing={pricingById.get(`deal:${deal.id}`)}
                  onOpenClient={onOpenClient} onEdit={() => setEditingDeal(deal)}
                  onPricing={() => openDealPricing(deal)}
                  confirming={deleteConfirmId === deal.id}
                  onDeleteAsk={() => setDeleteConfirmId(deal.id)}
                  onDeleteCancel={() => setDeleteConfirmId(null)}
                  onDelete={() => handleDelete(deal.id)} />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {allDealsByMonth.length === 0 && <div className="card"><EmptyDeals /></div>}
              {allDealsByMonth.map((group) => (
                <div key={group.key} className="card overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-bdr bg-s2/50">
                    <button onClick={() => { setMonthKey(group.key); setView('month'); }}
                      className="font-semibold text-sm text-accent hover:underline">
                      {dayjs(`${group.key}-01`).format('YYYY 年 M 月')}
                    </button>
                    <span className="text-xs text-ink-2">{group.totals.count} 筆・NT$ {formatMoney(group.totals.amount)}</span>
                  </div>
                  {group.list.map((deal) => (
                    <DealRow key={deal.id} deal={deal} fields={sortedFields}
                      pricing={pricingById.get(`deal:${deal.id}`)}
                      onOpenClient={onOpenClient} onEdit={() => setEditingDeal(deal)}
                      onPricing={() => openDealPricing(deal)}
                      confirming={deleteConfirmId === deal.id}
                      onDeleteAsk={() => setDeleteConfirmId(deal.id)}
                      onDeleteCancel={() => setDeleteConfirmId(null)}
                      onDelete={() => handleDelete(deal.id)} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {editingDeal && (
        <DealModal deal={editingDeal} dealFields={sortedFields}
          onClose={() => setEditingDeal(null)} onSave={handleSaveDeal} />
      )}
      {editingPricing && (
        <PricingEditorModal record={editingPricing} onClose={() => setEditingPricing(null)}
          onSave={async (record) => { await savePricingRecord(record); setEditingPricing(null); }} />
      )}
    </div>
  );
}

function EmptyDeals() {
  return <p className="text-center text-ink-3 text-sm py-10">尚無成交資料；成交歸檔後會自動帶入當下的成本快照。</p>;
}

function SummaryMetric({ label, value, tone = 'ink' }) {
  const toneClass = tone === 'accent' ? 'text-accent' : tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : 'text-ink';
  return (
    <div>
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className={`text-lg font-bold ${value == null ? 'text-ink-3' : toneClass}`}>
        {value == null ? '待補成本' : `NT$ ${formatMoney(value)}`}
      </p>
    </div>
  );
}

function DealRow({
  deal, fields, pricing, onOpenClient, onEdit, onPricing,
  confirming, onDeleteAsk, onDeleteCancel, onDelete,
}) {
  return (
    <div className="px-3 py-2.5 border-b border-bdr/50 last:border-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-ink-3 font-mono shrink-0">{dayjs(deal.date).format('MM/DD')}</span>
        {deal.clientId ? (
          <button onClick={() => onOpenClient(deal.clientId)} className="font-medium text-sm text-accent hover:underline">
            {deal.clientName || '未命名客戶'}
          </button>
        ) : <span className="font-medium text-sm text-ink">{deal.clientName || '未命名客戶'}</span>}
        {deal.note && <span className="text-xs text-ink-3 truncate">{deal.note}</span>}
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          {confirming ? (
            <>
              <button onClick={onDelete} className="btn-danger text-xs px-2 py-0.5">確認刪除</button>
              <button onClick={onDeleteCancel} className="btn-outline text-xs px-2 py-0.5">取消</button>
            </>
          ) : (
            <>
              <button onClick={onPricing} className="text-accent hover:underline text-xs">成本</button>
              <button onClick={onEdit} className="text-ink-3 hover:text-ink text-xs">編輯</button>
              <button onClick={onDeleteAsk} className="text-danger/40 hover:text-danger text-xs">刪除</button>
            </>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-1">
        <span className="text-xs font-semibold text-accent">NT$ {formatMoney(deal.amount)}</span>
        {fields.map((field) => {
          const value = deal.fields?.[field.id];
          if (!value) return null;
          return (
            <span key={field.id} className="text-[11px] px-1.5 py-0.5 rounded-full"
              style={{
                background: `${FIELD_COLORS[field.colorIdx % FIELD_COLORS.length]}18`,
                color: FIELD_COLORS[field.colorIdx % FIELD_COLORS.length],
              }}>
              {field.name} {formatMoney(value)}
            </span>
          );
        })}
      </div>
      <PricingBadges record={pricing} />
    </div>
  );
}

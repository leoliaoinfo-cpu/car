import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { FIELD_COLORS, formatMoney, sumDeals } from '../../utils/crm';
import { calculateProgressiveCommissionBonus, normalizeCommissionBonusRule, normalizePricingRecord, updatePricingCosts } from '../../utils/pricing';
import DealModal from './DealModal';
import DeliveryWorkflowPanel from './DeliveryWorkflowPanel';
import SupplierPanel from './SupplierPanel';
import {
  CostCatalogPanel,
  CustomPricingHistoryPanel,
  PricingBadges,
  PricingEditorModal,
  QuotePricingPanel,
} from './InternalPricing';

function sessionTimeLabel(seconds = 0) {
  const minutes = Math.max(0, Math.ceil(seconds / 60));
  return minutes > 0 ? `剩餘 ${minutes} 分鐘` : '即將自動上鎖';
}

export default function DealsPage({ onOpenClient, onBack, focusDealId = null, sessionRemainingSeconds = 0, onLock }) {
  const {
    deals,
    cases,
    dealFields,
    clients,
    quotePresets,
    costCatalog,
    customPricingHistory,
    pricingRecords,
    quoteDrafts,
    suppliers,
    saveDeal,
    deleteDeal,
    saveCostCatalog,
    saveCustomPricingHistory,
    savePricingRecord,
    saveQuoteDraft,
    saveSupplier,
    deleteSupplier,
  } = useApp();
  const [section, setSection] = useState(focusDealId ? 'fulfillment' : 'performance');
  const [view, setView] = useState('month');
  const [monthKey, setMonthKey] = useState(dayjs().format('YYYY-MM'));
  const [editingDeal, setEditingDeal] = useState(null);
  const [editingPricing, setEditingPricing] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [costSearch, setCostSearch] = useState('');

  useEffect(() => {
    if (focusDealId) setSection('fulfillment');
  }, [focusDealId]);

  const sortedFields = useMemo(
    () => [...dealFields].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [dealFields],
  );
  const pricingById = useMemo(
    () => new Map(pricingRecords.map((record) => [record.id, record])),
    [pricingRecords],
  );
  const centralCustomHistory = useMemo(() => {
    const clientNames = new Map(clients.map((client) => [client.id, client.name || '']));
    return customPricingHistory.map((row) => ({
      ...row,
      customerName: row.customerName || clientNames.get(row.clientId) || '',
    }));
  }, [clients, customPricingHistory]);
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
  const commissionBonusRule = useMemo(
    () => normalizeCommissionBonusRule(costCatalog?.commissionBonusRule),
    [costCatalog],
  );
  const payrollData = useMemo(() => {
    const caseById = new Map(cases.map((row) => [row.id, row]));
    const vehicleDeals = deals.filter((deal) => {
      const linkedCase = caseById.get(deal.caseId);
      const pricing = pricingById.get(`deal:${deal.id}`);
      const hasVehicleLine = (pricing?.lines || []).some((line) => line.kind === 'vehicle');
      return linkedCase ? linkedCase.type !== 'modification' : hasVehicleLine;
    });
    const recognized = vehicleDeals.filter((deal) => {
      if (!deal.commissionRecognizedAt) return false;
      return view === 'all' || deal.commissionRecognizedAt.slice(0, 7) === monthKey;
    });
    const rows = recognized.map((deal) => {
      const record = pricingById.get(`deal:${deal.id}`);
      const useCurrentAnnouncement = deal.commissionRecognizedAt >= commissionBonusRule.effectiveFrom;
      const announcedCommission = useCurrentAnnouncement
        ? Number(costCatalog?.models?.[record?.modelId]?.commission) : null;
      const commission = Number.isFinite(announcedCommission)
        ? announcedCommission : Number(record?.commissionTotal) || 0;
      const profit = record?.profit == null ? null
        : Number(record.profit) - (Number(record.commissionTotal) || 0) + commission;
      return { deal, record, commission, profit };
    });
    const monthlyUnits = new Map();
    for (const row of rows) {
      const key = row.deal.commissionRecognizedAt.slice(0, 7);
      monthlyUnits.set(key, (monthlyUnits.get(key) || 0) + 1);
    }
    let bonus = 0;
    for (const [key, count] of monthlyUnits.entries()) {
      bonus += calculateProgressiveCommissionBonus(count, commissionBonusRule, key);
    }
    const completeRows = rows.filter((row) => row.record?.costComplete && row.profit != null);
    return {
      rows,
      pending: vehicleDeals.filter((deal) => !deal.commissionRecognizedAt),
      units: rows.length,
      bonus,
      complete: completeRows.length,
      cost: completeRows.reduce((sum, row) => sum + (Number(row.record.costTotal) || 0), 0),
      commission: rows.reduce((sum, row) => sum + row.commission, 0),
      profit: completeRows.reduce((sum, row) => sum + row.profit, 0),
    };
  }, [deals, cases, pricingById, view, monthKey, costCatalog, commissionBonusRule]);

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
      setEditingPricing(normalizePricingRecord(existing));
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

  function openCostSettings(search = '') {
    setCostSearch(search);
    setEditingPricing(null);
    setSection('costs');
  }

  async function saveQuoteFromPricing({ quote, client }) {
    await saveQuoteDraft({ ...quote, clientId: quote.clientId || client?.id || null });
  }

  const tabs = [
    ['performance', '業績與利潤'],
    ['quotes', '報價利潤試算'],
    ['costs', '傭金與成本設定'],
    ['customPricing', '客製價格庫'],
    ['suppliers', '合作廠商'],
    ['fulfillment', '交車施工進度'],
  ];
  const focusedWorkflow = Boolean(focusDealId);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      {focusedWorkflow && (
        <div className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center gap-2 border-b border-bdr bg-bg/95 px-4 py-3 backdrop-blur">
          <button type="button" onClick={onBack} className="btn-outline min-h-11 shrink-0 px-3">← 返回案件</button>
          <div className="min-w-0 flex-1"><p className="font-bold text-ink">施工進度處理</p><p className="text-[11px] text-ink-3">專注模式・{sessionTimeLabel(sessionRemainingSeconds)}</p></div>
          {onLock && <button type="button" onClick={onLock} className="min-h-11 shrink-0 rounded-xl border border-danger/35 px-3 text-xs font-bold text-danger">立即上鎖</button>}
        </div>
      )}
      {!focusedWorkflow && onLock && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-bdr bg-s2/60 px-3 py-2">
          <p className="text-xs text-ink-3">後台已解鎖・{sessionTimeLabel(sessionRemainingSeconds)}</p>
          <button type="button" onClick={onLock} className="min-h-10 rounded-lg border border-danger/35 px-3 text-xs font-bold text-danger">立即上鎖</button>
        </div>
      )}
      {!focusedWorkflow && <div className="card p-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setSection(key)}
            className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold ${section === key ? 'bg-accent text-on-accent' : 'text-ink-2 hover:bg-s2'}`}>
            {label}
          </button>
        ))}
      </div>}

      {!focusedWorkflow && section === 'quotes' && (
        <QuotePricingPanel clients={clients} quoteDrafts={quoteDrafts} pricingRecords={pricingRecords}
          costCatalog={costCatalog} customPricingHistory={customPricingHistory}
          onSavePricing={savePricingRecord} onSaveCustomHistory={saveCustomPricingHistory}
          onSaveQuote={saveQuoteFromPricing}
          onOpenCostSettings={openCostSettings} />
      )}

      {!focusedWorkflow && section === 'costs' && (
        <CostCatalogPanel quotePresets={quotePresets} costCatalog={costCatalog}
          onSave={saveCostCatalog} initialSearch={costSearch} />
      )}

      {!focusedWorkflow && section === 'customPricing' && (
        <CustomPricingHistoryPanel entries={centralCustomHistory} onSave={saveCustomPricingHistory} />
      )}

      {(section === 'fulfillment' || focusedWorkflow) && (
        <DeliveryWorkflowPanel deals={deals} cases={cases} clients={clients} pricingById={pricingById}
          suppliers={suppliers} onSaveDeal={saveDeal} onOpenPricing={openDealPricing} onOpenClient={onOpenClient} focusDealId={focusDealId} />
      )}

      {!focusedWorkflow && section === 'suppliers' && (
        <SupplierPanel suppliers={suppliers} onSave={saveSupplier} onDelete={deleteSupplier} />
      )}

      {!focusedWorkflow && section === 'performance' && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-xl font-bold text-ink">📈 業績與單車利潤</h1>
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
            <div className="grid grid-cols-2 gap-3">
              <SummaryMetric label="成交金額" value={totals.amount} tone="accent" />
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

          <div className={`rounded-xl border px-4 py-3 ${payrollData.bonus > 0 ? 'border-ok/30 bg-ok/5' : 'border-bdr bg-s2/40'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-ink">交車月份薪資試算</p>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  只計算已確認實際交車的購車案件；成交日、預計交車日與施工進度都不會提前計薪。
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              <SummaryMetric label="已交車認列" value={payrollData.units} tone="accent" unit=" 台" />
              <SummaryMetric label="車輛佣金合計" value={payrollData.commission} tone="accent" />
              <SummaryMetric label={`案件利潤（完整 ${payrollData.complete}/${payrollData.units}）`}
                value={payrollData.complete ? payrollData.profit : null} tone={payrollData.profit < 0 ? 'danger' : 'ok'} />
              <SummaryMetric label="累進獎金" value={payrollData.bonus} tone="accent" />
              <SummaryMetric label="本月案件薪資" value={payrollData.complete ? payrollData.profit + payrollData.bonus : null}
                tone={(payrollData.profit + payrollData.bonus) < 0 ? 'danger' : 'ok'} />
            </div>
            <p className="mt-3 text-[11px] text-ink-3">
              {commissionBonusRule.effectiveFrom.replaceAll('-', '/')} 起；當月達 {commissionBonusRule.minUnits} 台，當月每台再加 NT$ {formatMoney(commissionBonusRule.bonusPerUnit)}。
            </p>
          </div>

          {view === 'month' && (
            <section className="card overflow-hidden">
              <div className="border-b border-bdr bg-accent/5 px-4 py-3">
                <h2 className="text-sm font-bold text-ink">交車薪資認列</h2>
                <p className="mt-0.5 text-[11px] text-ink-3">只有實際按下「確認交車並認列本月薪資」的購車案件，才會進入這個月的車輛佣金與累進台數。</p>
              </div>
              <div className="grid gap-3 p-4 md:grid-cols-2">
                <div className="rounded-xl border border-bdr bg-s2/40 p-3">
                  <p className="text-xs font-bold text-ink">{dayjs(`${monthKey}-01`).format('M 月')}已認列 {payrollData.rows.length} 台</p>
                  <div className="mt-2 space-y-2">
                    {payrollData.rows.length === 0 && <p className="text-xs text-ink-3">尚未認列交車。</p>}
                    {payrollData.rows.map(({ deal, commission }) => (
                      <div key={deal.id} className="flex items-center justify-between gap-2 rounded-lg bg-s1 px-2.5 py-2 text-xs">
                        <span className="min-w-0 truncate">{deal.clientName || '未命名客戶'}・{deal.model || deal.note || '車輛'}</span>
                        <span className="shrink-0 font-semibold text-accent">{dayjs(deal.commissionRecognizedAt).format('MM/DD')}・NT$ {formatMoney(commission)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-warn/25 bg-warn/5 p-3">
                  <p className="text-xs font-bold text-ink">待實際交車認列 {payrollData.pending.length} 台</p>
                  <div className="mt-2 space-y-2">
                    {payrollData.pending.length === 0 && <p className="text-xs text-ink-3">目前沒有待認列的購車案件。</p>}
                    {payrollData.pending.map((deal) => (
                      <div key={deal.id} className="flex items-center gap-2 rounded-lg bg-s1 px-2.5 py-2 text-xs">
                        <span className="min-w-0 flex-1 truncate">{deal.clientName || '未命名客戶'}・{deal.model || deal.note || '車輛'}</span>
                        {deal.clientId && <button type="button" onClick={() => onOpenClient(deal.clientId)} className="btn-outline min-h-9 shrink-0 px-2 text-[11px]">前往交車</button>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

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
        <DealModal deal={editingDeal} cases={cases} dealFields={sortedFields}
          onClose={() => setEditingDeal(null)} onSave={handleSaveDeal} />
      )}
      {editingPricing && (
        <PricingEditorModal record={editingPricing} costCatalog={costCatalog} onClose={() => setEditingPricing(null)}
          onOpenCostSettings={openCostSettings}
          onSave={async (record) => { await savePricingRecord(record); setEditingPricing(null); }} />
      )}
    </div>
  );
}

function EmptyDeals() {
  return <p className="text-center text-ink-3 text-sm py-10">尚無成交資料；建立成交案後會自動帶入當下的成本快照。</p>;
}

function SummaryMetric({ label, value, tone = 'ink', unit = '' }) {
  const toneClass = tone === 'accent' ? 'text-accent' : tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : 'text-ink';
  return (
    <div>
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className={`text-lg font-bold ${value == null ? 'text-ink-3' : toneClass}`}>
        {value == null ? '待補成本' : unit ? `${formatMoney(value)}${unit}` : `NT$ ${formatMoney(value)}`}
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

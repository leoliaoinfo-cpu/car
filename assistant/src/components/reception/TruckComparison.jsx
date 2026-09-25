import { useEffect, useMemo, useRef, useState } from 'react';
import truckData from '../../data/truckVariants.json';
import { STORAGE_KEYS } from '../../storageKeys';
import {
  CORE_TRUCK_METRICS, DETAIL_TRUCK_METRICS, buildTruckComparisonSummary,
  fieldConflict, isConfirmedUnder3500, truckMetricDifference, truckMetricDisplay,
} from '../../utils/truckComparison';

const STATUS = {
  verified: { text: '已查證', className: 'bg-ok/10 text-ok border-ok/30' },
  partial: { text: '部分查證', className: 'bg-warn/10 text-warn border-warn/30' },
  conflicted: { text: '資料有衝突', className: 'bg-danger/10 text-danger border-danger/30' },
  model_max_only: { text: '車系資料', className: 'bg-warn/10 text-warn border-warn/30' },
  pending: { text: '待確認', className: 'bg-s2 text-ink-3 border-bdr' },
};

const COMMON_NAMES = {
  Toyota: 'Town Ace／小發財', Suzuki: 'Carry', Mitsubishi: '得利卡／Zinger',
  Hyundai: 'Porter II', Hino: '200', CMC: '小霸王／菱利', Ford: 'Ranger',
};

function readLastSelection() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEYS.truckComparison) || '{}');
    return { competitorId: value.competitorId || '', k2500Id: value.k2500Id || 'k2500-01' };
  } catch {
    return { competitorId: '', k2500Id: 'k2500-01' };
  }
}

function StatusBadge({ status }) {
  const item = STATUS[status] || STATUS.pending;
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${item.className}`}>{item.text}</span>;
}

function VariantButton({ row, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`min-h-12 rounded-xl border px-3 py-2 text-left transition-colors ${active ? 'bg-accent text-on-accent border-accent' : 'bg-s1 text-ink border-bdr hover:border-accent/60'}`}>
      <span className="block text-sm font-semibold">{row.variant}</span>
      <span className={`block text-[10px] mt-1 ${active ? 'text-on-accent/80' : 'text-ink-3'}`}>
        {row.model_year ? `${row.model_year} 年式・` : ''}{STATUS[row.status]?.text || '待確認'}
      </span>
    </button>
  );
}

function MetricRow({ metric, competitor, k2500 }) {
  const difference = truckMetricDifference(competitor, k2500, metric);
  return (
    <div className="grid grid-cols-[5.2rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-bdr/60 py-3 last:border-0 items-start">
      <div className="text-xs font-semibold text-ink-2">{metric.label}</div>
      <div className="min-w-0">
        <strong className="block text-sm text-ink break-words">{truckMetricDisplay(competitor, metric)}</strong>
        {difference != null && difference !== 0 && (
          <span className={`text-[10px] ${difference > 0 ? 'text-accent' : 'text-ink-3'}`}>
            {difference > 0 ? '+' : '−'}{Math.abs(difference).toLocaleString('zh-TW')} {metric.unit}
          </span>
        )}
        {fieldConflict(competitor, metric.key) && <span className="block text-[10px] text-danger mt-1">此欄不判定差異</span>}
      </div>
      <div className="min-w-0">
        <strong className="block text-sm text-ink break-words">{truckMetricDisplay(k2500, metric)}</strong>
      </div>
    </div>
  );
}

export default function TruckComparison({ selection = null, onSelectionChange = null, onClose = null }) {
  const initial = selection || readLastSelection();
  const [competitorId, setCompetitorId] = useState(initial.competitorId);
  const [k2500Id, setK2500Id] = useState(initial.k2500Id);
  const [brand, setBrand] = useState(() => truckData.variants.find((row) => row.id === initial.competitorId)?.brand || '');
  const [model, setModel] = useState(() => truckData.variants.find((row) => row.id === initial.competitorId)?.model || '');
  const [expanded, setExpanded] = useState(false);
  const [showIdentification, setShowIdentification] = useState(false);
  const selectionMounted = useRef(false);

  const k2500Rows = useMemo(() => truckData.variants.filter((row) => row.brand === 'Kia' && row.model === 'K2500'), []);
  const competitors = useMemo(() => truckData.variants.filter((row) => row.brand !== 'Kia' && row.body === 'open_bed'), []);
  const brands = useMemo(() => [...new Set(competitors.map((row) => row.brand))], [competitors]);
  const models = useMemo(() => [...new Set(competitors.filter((row) => row.brand === brand).map((row) => row.model))], [competitors, brand]);
  const choices = competitors.filter((row) => row.brand === brand && (!model || row.model === model));
  const competitor = competitors.find((row) => row.id === competitorId) || null;
  const k2500 = k2500Rows.find((row) => row.id === k2500Id) || k2500Rows[0];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.truckComparison, JSON.stringify({ competitorId, k2500Id }));
    if (selectionMounted.current) {
      onSelectionChange?.({ competitorId, k2500Id, updatedAt: new Date().toISOString() });
    } else {
      selectionMounted.current = true;
    }
  }, [competitorId, k2500Id]);

  function chooseBrand(nextBrand) {
    const brandModels = [...new Set(competitors.filter((row) => row.brand === nextBrand).map((row) => row.model))];
    setBrand(nextBrand);
    setModel(brandModels.length === 1 ? brandModels[0] : '');
    setCompetitorId('');
    setShowIdentification(false);
  }

  return (
    <section className="card p-4 md:p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-[11px] tracking-widest text-accent font-semibold">TRUCK COMPARISON</p>
          <h2 className="text-xl font-bold mt-1">貨車規格比較</h2>
          <p className="text-xs text-ink-3 mt-1">品牌 → 車系 → 版本，全程點選；缺值與衝突不會當成 0，也不會算勝負。</p>
        </div>
        {onClose && <button type="button" onClick={onClose} className="btn-outline text-xs shrink-0">關閉</button>}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">1. 客戶正在看的車</h3>{competitor && <button type="button" className="btn-ghost text-xs" onClick={() => { setCompetitorId(''); setBrand(''); setModel(''); }}>重新選擇</button>}</div>
        {!brand && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{brands.map((item) => <button type="button" key={item} onClick={() => chooseBrand(item)} className="min-h-12 rounded-xl border border-bdr bg-s1 px-3 py-2 text-left"><strong className="block text-sm">{item}</strong><span className="text-[10px] text-ink-3">{COMMON_NAMES[item] || item}</span></button>)}</div>}
        {brand && !model && models.length > 1 && <div className="grid sm:grid-cols-2 gap-2">{models.map((item) => <button type="button" key={item} onClick={() => { setModel(item); setCompetitorId(''); }} className="min-h-11 rounded-xl border border-bdr bg-s1 px-3 text-left text-sm font-semibold">{item}</button>)}</div>}
        {brand && (model || models.length === 1) && <><div className="grid sm:grid-cols-2 gap-2">{choices.map((row) => <VariantButton key={row.id} row={row} active={row.id === competitorId} onClick={() => { setCompetitorId(row.id); setShowIdentification(false); }} />)}</div><button type="button" onClick={() => { setCompetitorId(''); setShowIdentification((value) => !value); }} className="btn-outline w-full text-xs">不確定是哪個版本・看辨識線索</button></>}
        {showIdentification && choices.length > 0 && <div className="rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs text-ink-2"><strong className="text-warn">先不要用單一版本數字回答</strong><p className="mt-1">請確認貨床材質、手排／自排、單廂／雙廂或型號。這個車系可選版本：</p><ul className="mt-2 space-y-1 list-disc pl-5">{choices.map((row) => <li key={row.id}>{row.variant}</li>)}</ul></div>}
        {brand && !competitor && choices.some((row) => !isConfirmedUnder3500(row)) && <p className="text-[11px] text-warn">「待確認／車系資料」可查看已知資訊，但不列入已確認 3.5 噸內車款排名。</p>}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold">2. K2500 版本</h3>
        <div className="grid sm:grid-cols-2 gap-2">{k2500Rows.map((row) => <VariantButton key={row.id} row={row} active={row.id === k2500Id} onClick={() => setK2500Id(row.id)} />)}</div>
      </div>

      {competitor && k2500 && (
        <div className="space-y-4">
          <div className="sticky top-0 z-10 rounded-2xl border border-accent/30 bg-s1/95 backdrop-blur p-3 shadow-card">
            <div className="grid grid-cols-[5.2rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 items-start">
              <span className="text-[10px] text-ink-3 pt-1">比較車款</span>
              <div><strong className="text-sm block">{competitor.brand} {competitor.model}</strong><span className="text-[10px] text-ink-3">{competitor.variant}</span><div className="mt-1"><StatusBadge status={competitor.status} /></div></div>
              <div><strong className="text-sm block">Kia K2500</strong><span className="text-[10px] text-ink-3">{k2500.variant}</span><div className="mt-1"><StatusBadge status={k2500.status} /></div></div>
            </div>
          </div>

          <div className="rounded-2xl border border-bdr bg-s1 px-3">
            <div className="grid grid-cols-[5.2rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 py-2 text-[10px] text-ink-3 border-b border-bdr"><span>核心規格</span><span>客戶車款</span><span>K2500</span></div>
            {CORE_TRUCK_METRICS.map((metric) => <MetricRow key={metric.key} metric={metric} competitor={competitor} k2500={k2500} />)}
          </div>

          <div className="rounded-xl bg-accent/10 border border-accent/25 p-3 text-sm text-ink-2 leading-relaxed">
            <strong className="block text-xs text-accent mb-1">現場中性說法</strong>
            {buildTruckComparisonSummary(competitor, k2500)}
          </div>

          <button type="button" onClick={() => setExpanded((value) => !value)} className="btn-outline w-full">{expanded ? '收起完整規格' : '展開完整規格'}</button>
          {expanded && (
            <div className="rounded-2xl border border-bdr bg-s1 px-3">
              {DETAIL_TRUCK_METRICS.map((metric) => <MetricRow key={metric.key} metric={metric} competitor={competitor} k2500={k2500} />)}
              <div className="grid grid-cols-[5.2rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-bdr/60 py-3 text-xs"><strong className="text-ink-2">燃料</strong><span>{competitor.fuel || '待確認'}</span><span>{k2500.fuel || '待確認'}</span></div>
              <div className="grid grid-cols-[5.2rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-bdr/60 py-3 text-xs"><strong className="text-ink-2">變速箱</strong><span>{competitor.transmission || '待確認'}</span><span>{k2500.transmission || '待確認'}</span></div>
              <div className="grid grid-cols-[5.2rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 py-3 text-xs"><strong className="text-ink-2">驅動</strong><span>{competitor.drive || '待確認'}</span><span>{k2500.drive || '待確認'}</span></div>
            </div>
          )}

          {(competitor.notes || competitor.field_conflicts?.length > 0) && <div className="rounded-xl bg-warn/10 border border-warn/25 p-3 text-xs text-ink-2 leading-relaxed"><strong className="text-warn">資料提醒：</strong>{competitor.notes || competitor.field_conflicts[0]?.display}</div>}
          <div className="grid grid-cols-2 gap-2">
            <a href={competitor.source_url} target="_blank" rel="noreferrer" className="btn-outline text-center text-xs">客戶車款原廠規格 ↗</a>
            <a href={k2500.source_url} target="_blank" rel="noreferrer" className="btn-outline text-center text-xs">K2500 原廠規格 ↗</a>
          </div>
          {competitor.dimension_source_url && <a href={competitor.dimension_source_url} target="_blank" rel="noreferrer" className="btn-ghost block text-center text-xs">車身尺寸補充來源 ↗</a>}
          {(competitor.field_conflicts || []).map((conflict) => conflict.news_url && <a key={conflict.news_url} href={conflict.news_url} target="_blank" rel="noreferrer" className="btn-ghost block text-center text-xs">衝突資料的另一份原廠來源 ↗</a>)}
          <p className="text-[10px] text-ink-3 text-center">規格快照：{truckData.as_of}。價格未納入競品比較；K2500 報價仍使用系統既有統一車價。</p>
        </div>
      )}
    </section>
  );
}


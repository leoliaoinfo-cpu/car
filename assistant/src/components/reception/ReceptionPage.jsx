import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { calculateQuoteTotals } from '../../utils/pricing';
import { findDuplicateClient, generateId } from '../../utils/crm';
import {
  CARGO_OPTIONS, CURRENT_VEHICLES, DRIVER_OPTIONS, ENVIRONMENT_OPTIONS, LOAD_OPTIONS,
  REASON_OPTIONS, RECEPTION_INDUSTRIES, REQUIREMENT_TYPES, RIDER_OPTIONS,
  TAILGATE_CANVAS_CHECKS,
  dependencyReminders, heightPlanning, heightPlanSummary, newReceptionSession, receptionPromptStatus,
  requirementPendingItems, requirementSummary, requiresHeightPlanning, toggleListValue,
} from '../../utils/reception';
import {
  VEHICLE_VARIANTS, convertMmToTaiwaneseChi, formatTwd, formatVehiclePrice, getVehicleVariant,
} from '../../utils/vehicles';
import TruckComparison from './TruckComparison';

const CHIP = 'min-h-11 rounded-xl border px-3 py-2 text-sm transition-colors text-left';
const selectedChip = (selected) => `${CHIP} ${selected ? 'bg-accent text-on-accent border-accent font-semibold' : 'bg-s1 text-ink-2 border-bdr hover:border-accent/60'}`;

function Chip({ active, children, onClick }) {
  return <button type="button" onClick={onClick} className={selectedChip(active)}>{children}</button>;
}

function ChipGroup({ options, value, onChange, multi = false }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = multi ? (value || []).includes(option) : value === option;
        return <Chip key={option} active={active} onClick={() => onChange(multi ? toggleListValue(value, option) : option)}>{option}</Chip>;
      })}
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <section className="bg-s1 border border-bdr/80 rounded-2xl p-4 md:p-5 shadow-card space-y-4">
      <div><h2 className="font-bold text-ink text-base">{title}</h2>{hint && <p className="text-xs text-ink-3 mt-1">{hint}</p>}</div>
      {children}
    </section>
  );
}

function FieldBlock({ label, children, note }) {
  return <div className="space-y-2"><div className="text-sm font-semibold text-ink-2">{label}</div>{children}{note && <p className="text-xs text-ink-3 leading-relaxed">{note}</p>}</div>;
}

export default function ReceptionPage({ startNewToken, onStartConsumed, onOpenClient, onOpenQuotes, onOpenCatalog }) {
  const {
    receptionSessions, saveReceptionSession, deleteReceptionSession,
    clients, quotePresets, saveQuoteDraft, saveClient, updateClient, cats, stages, heightConfig,
  } = useApp();
  const [view, setView] = useState('sessions');
  const [selectedId, setSelectedId] = useState(null);
  const [showFormalize, setShowFormalize] = useState(false);
  const [formal, setFormal] = useState({ name: '', phone: '', lineId: '', company: '', address: '', budget: '', purchaseTime: '', payment: '', loanNeed: '', nextDate: '' });
  const [notice, setNotice] = useState('');
  const [showSessionComparison, setShowSessionComparison] = useState(false);

  const sorted = useMemo(() => [...receptionSessions].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')), [receptionSessions]);
  const session = receptionSessions.find((row) => row.id === selectedId) || null;

  useEffect(() => {
    if (!startNewToken) return;
    createSession().finally(() => onStartConsumed?.());
  }, [startNewToken]);

  async function createSession() {
    const next = newReceptionSession(receptionSessions.length + 1);
    await saveReceptionSession(next);
    setSelectedId(next.id);
    setView('sessions');
  }

  async function update(patch) {
    if (!session) return;
    await saveReceptionSession({ ...session, ...patch });
  }

  async function updateRequirement(name, patch) {
    if (!session) return;
    await update({ requirements: { ...session.requirements, [name]: { ...(session.requirements?.[name] || {}), ...patch } } });
  }

  async function formalize() {
    if (!session || !formal.name.trim()) return;
    const selectedVariant = getVehicleVariant(session.vehicleVariantId);
    const generatedHeightSummary = heightPlanSummary(session, selectedVariant, heightConfig);
    const duplicate = findDuplicateClient(clients, {
      name: formal.name.trim(), phone: formal.phone,
    });
    if (duplicate?.reason === 'phone') {
      const client = await updateClient(duplicate.client.id, (current) => ({
        ...current,
        name: formal.name.trim() || current.name,
        phone: formal.phone || current.phone,
        lineId: formal.lineId || current.lineId,
        company: formal.company || current.company,
        address: formal.address || current.address,
        budget: formal.budget || current.budget,
        purchaseTime: formal.purchaseTime || current.purchaseTime,
        paymentMethod: formal.payment || current.paymentMethod,
        loanNeed: formal.loanNeed || current.loanNeed,
        nextDate: formal.nextDate || current.nextDate || null,
        industry: session.industry || current.industry,
        source: session.source || current.source,
        customerMode: session.customerMode,
        receptionSessionId: session.id,
        demandProfile: session,
        requirementSummary: requirementSummary(session),
        pendingRequirements: requirementPendingItems(session, selectedVariant, heightConfig),
        heightPlanSummary: generatedHeightSummary || current.heightPlanSummary || '',
        notes: [current.notes, session.quickNote].filter(Boolean).join('\n'),
        truckComparison: session.truckComparison || current.truckComparison || null,
      }));
      await saveReceptionSession({ ...session, status: 'formalized', clientId: client.id, displayName: client.name });
      setShowFormalize(false);
      onOpenClient?.(client.id);
      return;
    }
    const client = {
      id: generateId('client'), name: formal.name.trim(), phone: formal.phone, lineId: formal.lineId,
      company: formal.company, address: formal.address, budget: formal.budget, purchaseTime: formal.purchaseTime,
      paymentMethod: formal.payment, loanNeed: formal.loanNeed, nextDate: formal.nextDate || null,
      industry: session.industry, source: session.source, customerMode: session.customerMode,
      catId: cats[0]?.id || '', stageId: stages[0]?.id || '',
      clientType: formal.company ? 'company' : 'personal', log: [], missedCalls: 0,
      receptionSessionId: session.id, demandProfile: session,
      requirementSummary: requirementSummary(session), pendingRequirements: requirementPendingItems(session, selectedVariant, heightConfig),
      heightPlanSummary: generatedHeightSummary,
      notes: session.quickNote || '', createdAt: new Date().toISOString(),
      truckComparison: session.truckComparison || null,
    };
    await saveClient(client);
    await saveReceptionSession({ ...session, status: 'formalized', clientId: client.id, displayName: client.name });
    setShowFormalize(false);
    onOpenClient?.(client.id);
  }

  function findCatalogItem(name, detail) {
    const addons = quotePresets.addons || [];
    if (name === '貨斗底板') {
      if (detail.material === '橡膠') return addons.find((x) => x.id === 'qa-floor-rubber');
      if (detail.material === '白鐵') return addons.find((x) => x.id === 'qa-floor-stainless');
      if (detail.material === '鍍鋅鐵板' && detail.surface === '平板') return addons.find((x) => x.id === 'qa-floor-galvanized-flat');
      if (detail.material === '鍍鋅鐵板') return addons.find((x) => x.id === 'qa-floor-galvanized');
    }
    if (name === '升降尾門') {
      const ids = { '2.5': 'qa-tailgate-25', '3': 'qa-tailgate-30', '3.5': 'qa-tailgate-35', '4': 'qa-tailgate-40', '4.5': 'qa-tailgate-45', '5': 'qa-tailgate-50', '5.5': 'qa-tailgate-55', '6': 'qa-tailgate-60-special' };
      return addons.find((x) => x.id === ids[detail.size]);
    }
    return addons.find((x) => x.cat === name || x.name.includes(name));
  }

  async function addConfirmedToQuote() {
    if (!session) return;
    const items = [];
    const variant = getVehicleVariant(session.vehicleVariantId);
    const plan = heightPlanning(session, variant, heightConfig);
    if (variant && session.customerMode === '新車＋改裝') items.push({ id: generateId('qi'), kind: 'vehicle', catalogId: variant.id, name: '車輛售價', price: variant.msrpTwd, pending: false, discounts: [] });
    for (const [name, detail] of Object.entries(session.requirements || {})) {
      if (!detail?.selected || detail.status !== '已確認') continue;
      if (plan.itemStatus[name] && !plan.itemStatus[name].canConfirm) continue;
      const catalog = findCatalogItem(name, detail);
      if (!catalog) continue;
      items.push({
        id: generateId('qi'), kind: 'addon', catalogId: catalog.id, name: catalog.name,
        price: catalog.price || 0, pending: !!catalog.pendingPrice,
        description: catalog.desc || '', note: detail.note || '', discounts: [],
      });
    }
    if (!items.some((item) => item.kind === 'addon')) {
      setNotice('目前沒有「已確認」且能對應現有型錄的配件。需求不會自動變成報價。');
      return;
    }
    const totals = calculateQuoteTotals(items.filter((item) => !item.pending), []);
    const linkedClientId = session.clientId || '';
    const quote = {
      id: generateId('quote'), date: dayjs().format('YYYY-MM-DD'), clientId: linkedClientId,
      customerName: linkedClientId ? session.displayName : '', customerPhone: '',
      modelId: variant?.id || null, model: variant?.quoteName || '',
      excludeVehiclePrice: session.customerMode === '只做改裝', items, generalDiscounts: [],
      requirements: requirementSummary(session).join('、'),
      note: session.quickNote || '',
      internalHeightPlanSummary: heightPlanSummary(session, variant, heightConfig),
      originalTotal: totals.originalTotal, itemDiscountTotal: 0, generalDiscountTotal: 0, discountTotal: 0, total: totals.total,
      sourceReceptionId: session.id, createdAt: new Date().toISOString(),
    };
    await saveQuoteDraft(quote);
    setNotice('已把確認完成的需求加入原本報價系統。');
    onOpenQuotes?.();
  }

  if (session) return <>
    <ReceptionEditor session={session} update={update} updateRequirement={updateRequirement} heightConfig={heightConfig}
      onBack={() => setSelectedId(null)} onFormalize={() => setShowFormalize(true)} onAddQuote={addConfirmedToQuote}
      onOpenCatalog={onOpenCatalog}
      onOpenComparison={() => setShowSessionComparison(true)}
      onHold={async () => { await update({ status: 'hold' }); setSelectedId(null); }}
      onNoFollow={async () => { await update({ status: 'closed' }); setSelectedId(null); }}
      notice={notice} onNotice={() => setNotice('')} />
    {showSessionComparison && (
      <><div className="overlay" onClick={() => setShowSessionComparison(false)} /><div className="safe-screen fixed inset-0 z-[80] overflow-y-auto bg-bg/95 p-3"><div className="max-w-4xl mx-auto"><TruckComparison selection={session.truckComparison || { competitorId: '', k2500Id: 'k2500-01' }} onSelectionChange={(truckComparison) => update({ truckComparison })} onClose={() => setShowSessionComparison(false)} /></div></div></>
    )}
    {showFormalize && <FormalizeModal form={formal} setForm={setFormal} onClose={() => setShowFormalize(false)} onSave={formalize} />}
  </>;

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-5 py-4 md:py-6 space-y-4">
      <section className="rounded-3xl bg-s1 border border-bdr p-5 md:p-7 shadow-card">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[11px] tracking-[0.2em] text-accent font-semibold">SHOWROOM RECEPTION</p><h1 className="text-2xl font-bold mt-1">展間接待</h1><p className="text-sm text-ink-2 mt-2">先自然聊天、快速記需求；有後續再正式建檔。</p></div>
          <button onClick={createSession} className="btn-primary min-h-11 shrink-0">＋ 新增接待</button>
        </div>
        <div className="flex gap-2 mt-5">
          <Chip active={view === 'sessions'} onClick={() => setView('sessions')}>接待紀錄</Chip>
          <Chip active={view === 'quick'} onClick={() => setView('quick')}>K2500 速查</Chip>
          <Chip active={view === 'compare'} onClick={() => setView('compare')}>貨車比較</Chip>
        </div>
      </section>

      {view === 'quick' ? <VehicleQuickReference /> : view === 'compare' ? <TruckComparison /> : (
        sorted.length === 0 ? <section className="card p-10 text-center"><h2 className="font-bold text-lg">還沒有接待紀錄</h2><p className="text-sm text-ink-3 mt-2">客人進來先按「新增接待」，不用姓名電話也能開始。</p><button onClick={createSession} className="btn-primary mt-5">＋ 新增接待</button></section> :
          <div className="grid md:grid-cols-2 gap-3">{sorted.map((row) => (
            <article key={row.id} className="card p-4">
              <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">{row.displayName}</h2><p className="text-xs text-ink-3 mt-1">{row.source || '接待'}・{row.customerMode}・{dayjs(row.updatedAt).format('M/D HH:mm')}</p></div><span className={`badge ${row.status === 'formalized' ? 'bg-ok/10 text-ok' : 'bg-accent/10 text-accent'}`}>{{ formalized: '已建檔', hold: '先保留', closed: '無後續', active: '接待中' }[row.status] || '接待中'}</span></div>
              <p className="text-sm text-ink-2 mt-3 line-clamp-2">{[row.industry, row.currentVehicle, ...(row.cargo || [])].filter(Boolean).join('・') || '尚未開始記錄需求'}</p>
              <div className="flex gap-2 mt-4"><button onClick={() => setSelectedId(row.id)} className="btn-primary flex-1">開啟</button><button onClick={() => deleteReceptionSession(row.id)} className="btn-ghost text-danger">刪除</button></div>
            </article>
          ))}</div>
      )}

      {showFormalize && <FormalizeModal form={formal} setForm={setFormal} onClose={() => setShowFormalize(false)} onSave={formalize} />}
    </div>
  );
}

function ReceptionEditor({ session, update, updateRequirement, heightConfig, onBack, onFormalize, onAddQuote, onOpenCatalog, onOpenComparison, onHold, onNoFollow, notice, onNotice }) {
  const [handoffCopyStatus, setHandoffCopyStatus] = useState('');
  const promptStatus = receptionPromptStatus(session);
  const summary = requirementSummary(session);
  const variant = getVehicleVariant(session.vehicleVariantId);
  const heightPlan = heightPlanning(session, variant, heightConfig);
  const generatedHeightSummary = heightPlanSummary(session, variant, heightConfig);
  const pending = requirementPendingItems(session, variant, heightConfig);
  const reminders = dependencyReminders(session, variant, heightConfig);
  const heightTriggered = requiresHeightPlanning(session);
  const copyHandoff = async () => {
    if (!generatedHeightSummary) return;
    try {
      await navigator.clipboard.writeText(generatedHeightSummary);
      setHandoffCopyStatus('已複製，可直接貼給施工廠商');
    } catch {
      setHandoffCopyStatus('無法自動複製，請長按下方內容複製');
    }
  };
  const setRequirementSelected = (name) => {
    const selected = !!session.requirements?.[name]?.selected;
    const currentStatus = session.requirements?.[name]?.status;
    updateRequirement(name, {
      selected: !selected,
      status: !selected && ['帆布', '箱體', '伸縮箱體', '升降尾門'].includes(name) ? '待確認' : currentStatus || '考慮中',
    });
  };

  return (
    <div className="min-h-[100dvh] bg-bg pb-24">
      <header className="safe-panel sticky top-0 z-30 bg-s1/95 backdrop-blur border-b border-bdr">
        <div className="max-w-4xl mx-auto px-3 py-3 flex items-center gap-2"><button onClick={onBack} className="btn-ghost text-sm">← 接待列表</button><div className="flex-1 min-w-0"><h1 className="font-bold truncate">{session.displayName}</h1><p className="text-[11px] text-ink-3">自動儲存・{session.customerMode}</p></div><button onClick={onOpenComparison} className="btn-outline text-xs shrink-0">貨車比較</button><button onClick={onFormalize} className="btn-primary text-xs shrink-0">正式建檔</button></div>
        <div className="max-w-4xl mx-auto px-3 pb-2 overflow-x-auto"><div className="flex gap-1.5 min-w-max">{promptStatus.map(([label, done], idx) => <span key={label} className={`text-[11px] ${done ? 'text-ok' : 'text-ink-3'}`}>{idx > 0 && <span className="mr-1.5 text-bdr">→</span>}{label} {done ? '✓' : '○'}</span>)}</div></div>
      </header>
      <main className="max-w-4xl mx-auto p-3 md:p-5 space-y-4">
        <Section title="接待方式與客戶屬性" hint="不用先問姓名電話">
          <ChipGroup options={['現場接待', '電話詢問', 'LINE／網路來客']} value={session.source} onChange={(source) => update({ source })} />
          <ChipGroup options={['新車＋改裝', '只做改裝']} value={session.customerMode} onChange={(customerMode) => update({ customerMode })} />
        </Section>

        <Section title="1. 基本用車狀況" hint="做什麼、開什麼、載什麼、誰在開、為什麼來、平常跑哪">
          <FieldBlock label="行業／工作類型"><ChipGroup options={RECEPTION_INDUSTRIES} value={session.industry} onChange={(industry) => update({ industry })} /><input value={RECEPTION_INDUSTRIES.includes(session.industry) ? '' : session.industry} onChange={(e) => update({ industry: e.target.value })} placeholder="其他行業（可輸入）" className="w-full min-h-11" /></FieldBlock>
          <FieldBlock label="目前用車"><ChipGroup options={CURRENT_VEHICLES} value={session.currentVehicle} onChange={(currentVehicle) => update({ currentVehicle })} /><input value={CURRENT_VEHICLES.includes(session.currentVehicle) ? '' : session.currentVehicle} onChange={(e) => update({ currentVehicle: e.target.value })} placeholder="其他品牌／車型" className="w-full min-h-11" /></FieldBlock>
          <FieldBlock label="主要載運"><ChipGroup options={CARGO_OPTIONS} value={session.cargo} multi onChange={(cargo) => update({ cargo })} /></FieldBlock>
          <FieldBlock label="平常大概載多少" note="這是工作實際載重紀錄，不代表 Kia K2500 合法核定載重。"><ChipGroup options={LOAD_OPTIONS} value={session.loadRange} onChange={(loadRange) => update({ loadRange })} /><div className="flex items-center gap-2"><input type="number" inputMode="numeric" value={session.loadKg} onChange={(e) => update({ loadKg: e.target.value })} placeholder="實際重量" className="w-36 min-h-11" /><span className="text-sm text-ink-3">kg</span></div>{['1.5～2噸', '2噸以上'].includes(session.loadRange) && <p className="rounded-xl bg-warn/10 border border-warn/30 p-3 text-xs text-warn">請再確認車型核定載重與改裝後重量。</p>}</FieldBlock>
          <FieldBlock label="平常誰在開"><ChipGroup options={DRIVER_OPTIONS} value={session.driver} onChange={(driver) => update({ driver })} /></FieldBlock>
          <FieldBlock label="平常通常坐幾人"><ChipGroup options={RIDER_OPTIONS} value={session.riders} onChange={(riders) => update({ riders })} /></FieldBlock>
          <FieldBlock label="這次看車原因"><ChipGroup options={REASON_OPTIONS} value={session.reasons} multi onChange={(reasons) => update({ reasons })} /><textarea value={session.painPoint} onChange={(e) => update({ painPoint: e.target.value })} placeholder="目前這台最不夠用的地方" rows={2} className="w-full" /></FieldBlock>
          <FieldBlock label="主要使用環境"><ChipGroup options={ENVIRONMENT_OPTIONS} value={session.environments} multi onChange={(environments) => update({ environments })} /></FieldBlock>
        </Section>

        <Section title="2. 使用環境與限制">
          {!heightTriggered && <FieldBlock label="會進地下室／有限高場所嗎？"><ChipGroup options={['不會', '會下地下室', '有其他限高場所', '還不確定']} value={session.parking === '會' ? '會下地下室' : session.parking} onChange={(parking) => update({ parking, clearanceUnknown: false })} /><p className="text-xs text-ink-3">選到帆布、箱體、伸縮箱體或升降尾門時，系統會立即展開完整車高計算。</p></FieldBlock>}
          <FieldBlock label="會載長料嗎？"><ChipGroup options={['不會', '偶爾', '會']} value={session.longMaterial} onChange={(longMaterial) => update({ longMaterial })} />{session.longMaterial !== '不會' && <div className="rounded-2xl bg-s2 p-3 space-y-3"><ChipGroup options={['梯子', '管材', '木料', '鐵料', '其他']} value={session.longMaterialTypes} multi onChange={(longMaterialTypes) => update({ longMaterialTypes })} /><ChipGroup options={['3m內', '3～4m', '4～5m', '5m以上', '不知道']} value={session.longMaterialLength} onChange={(longMaterialLength) => update({ longMaterialLength })} /></div>}</FieldBlock>
        </Section>

        <Section title="3. 車型需求" hint="非必填；售價與規格統一從八個 Vehicle Variant 讀取">
          <FieldBlock label="車室"><ChipGroup options={['單廂', '大單廂', '雙廂', '還不確定']} value={session.cabNeed} onChange={(cabNeed) => update({ cabNeed })} /></FieldBlock>
          <FieldBlock label="驅動"><ChipGroup options={['2WD', '4WD', '還不確定']} value={session.driveNeed} onChange={(driveNeed) => update({ driveNeed })} /></FieldBlock>
          <FieldBlock label="變速箱"><ChipGroup options={['自排', '手排', '都可以', '還不確定']} value={session.transmissionNeed} onChange={(transmissionNeed) => update({ transmissionNeed })} /></FieldBlock>
          <div className="grid sm:grid-cols-2 gap-2">{VEHICLE_VARIANTS.filter((row) => (!session.cabNeed || session.cabNeed === '還不確定' || row.cab === session.cabNeed) && (!session.driveNeed || session.driveNeed === '還不確定' || row.drive === session.driveNeed) && (!session.transmissionNeed || ['都可以', '還不確定'].includes(session.transmissionNeed) || row.transmission === session.transmissionNeed)).map((row) => <button key={row.id} onClick={() => update({ vehicleVariantId: row.id })} className={`${selectedChip(session.vehicleVariantId === row.id)} flex justify-between gap-3`}><span>{row.name}</span><strong>{formatVehiclePrice(row.msrpTwd)}</strong></button>)}</div>
        </Section>

        <Section title="4. 車體／配備需求" hint="需求不等於報價；選了才展開，確認後才能加入報價">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{REQUIREMENT_TYPES.map((name) => <Chip key={name} active={!!session.requirements?.[name]?.selected} onClick={() => setRequirementSelected(name)}>{name}</Chip>)}</div>
          {heightTriggered && <HeightPlanningPanel session={session} update={update} plan={heightPlan} config={heightConfig} />}
          {REQUIREMENT_TYPES.filter((name) => session.requirements?.[name]?.selected).map((name) => <RequirementCard key={name} name={name} value={session.requirements[name]} session={session} heightPlan={heightPlan} update={(patch) => updateRequirement(name, patch)} onOpenCatalog={onOpenCatalog} />)}
        </Section>

        {(reminders.length > 0 || pending.length > 0) && <Section title="5. 待確認與施工提醒" hint="這些是業務提醒，不是正式施工指示">{reminders.map((text) => <p key={text} className="rounded-xl bg-warn/10 border border-warn/25 p-3 text-sm text-ink-2">{text}</p>)}{pending.length > 0 && <div><p className="text-xs font-semibold text-warn mb-2">待確認</p><div className="flex flex-wrap gap-2">{pending.map((item) => <span key={item} className="badge bg-s2 text-ink-2">○ {item}</span>)}</div></div>}</Section>}

        <Section title="6. 需求摘要"><div className="grid sm:grid-cols-2 gap-x-5 gap-y-2 text-sm">{[['行業', session.industry], ['目前車', session.currentVehicle], ['載運', (session.cargo || []).join('＋')], ['載重', session.loadKg ? `約 ${session.loadKg}kg` : session.loadRange], ['駕駛', session.driver], ['路線', (session.environments || []).join('＋')], ['限高', ['會', '會下地下室', '有其他限高場所'].includes(session.parking) ? `${session.clearanceCm || '待確認'}cm` : session.parking], ['考慮車型', variant?.name]].map(([label, value]) => value && <div key={label} className="flex justify-between gap-3 border-b border-bdr/40 py-2"><span className="text-ink-3">{label}</span><strong className="text-right">{value}</strong></div>)}</div>{summary.length > 0 && <div><p className="text-xs text-ink-3 mb-2">車體／配備</p><div className="flex flex-wrap gap-2">{summary.map((text) => <span key={text} className="badge bg-accent/10 text-accent">{text}</span>)}</div></div>}{generatedHeightSummary && <div className="space-y-2"><div className="flex items-center justify-between gap-2"><p className="text-xs text-ink-3">自動施工交接</p><button type="button" onClick={copyHandoff} className="btn-outline text-xs">📋 複製施工交接</button></div><pre className="whitespace-pre-wrap rounded-xl bg-s2 border border-bdr p-3 text-xs leading-relaxed font-sans">{generatedHeightSummary}</pre>{handoffCopyStatus && <p className="text-xs text-ok">{handoffCopyStatus}</p>}</div>}<textarea value={session.quickNote} onChange={(e) => update({ quickNote: e.target.value })} placeholder="快速備註（手機可使用鍵盤語音輸入）" rows={4} className="w-full" /><textarea value={session.handoffNote} onChange={(e) => update({ handoffNote: e.target.value })} placeholder="補充交接備註（自動施工交接之外的提醒）" rows={3} className="w-full" /></Section>

        {notice && <div className="rounded-xl bg-accent/10 border border-accent/30 p-3 text-sm flex gap-3"><span className="flex-1">{notice}</span><button onClick={onNotice}>×</button></div>}
        <div className="grid grid-cols-2 gap-2"><button onClick={onAddQuote} className="btn-primary min-h-12 col-span-2">將已確認需求加入報價</button><button onClick={onFormalize} className="btn-outline min-h-12">正式建檔</button><button onClick={onHold} className="btn-outline min-h-12">先保留</button><button onClick={onNoFollow} className="btn-ghost min-h-11 col-span-2 text-ink-3">無後續</button></div>
      </main>
    </div>
  );
}

function HeightPlanningPanel({ session, update, plan, config }) {
  const limited = ['會', '會下地下室', '有其他限高場所'].includes(session.parking);
  const parkingValue = session.parking === '會' ? '會下地下室' : session.parking;
  const quickClearances = ['180', '190', '200', '210', '220', '230'];
  const clearanceMode = session.clearanceMode || (session.clearanceUnknown ? 'unknown' : quickClearances.includes(String(session.clearanceCm)) ? String(session.clearanceCm) : session.clearanceCm ? 'custom' : '');
  const reserveMode = session.safetyReserveMode || (['5', '10', '15'].includes(String(session.safetyReserveCm)) ? String(session.safetyReserveCm) : session.safetyReserveCm !== '' && session.safetyReserveCm != null ? 'custom' : '10');
  const statusLabel = (item) => item?.kind === 'danger' ? `⛔ 預估超高 ${Math.abs(item.marginCm)} cm` : item?.kind === 'warning' ? `⚠️ 只剩 ${item.marginCm} cm，接近限制` : item?.kind === 'ok' ? '✅ 目前高度條件可規劃' : '⚠️ 暫定，資料尚未確認';
  return <div className="rounded-2xl border-2 border-warn/35 bg-warn/5 p-4 space-y-4">
    <div><h3 className="font-bold text-lg">⚠️ 車高與限高確認</h3><div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2 text-xs text-ink-2"><span>1. 先問地下室／限高</span><span>2. 確認避震</span><span>3. 確認葉片</span><span>4. 算貨斗離地</span><span>5. 算剩餘高度</span><span>6. 再選帆布／箱體</span></div></div>
    <FieldBlock label="老闆，平常會不會下地下室，或進有限高的地方？">
      <ChipGroup options={['不會', '會下地下室', '有其他限高場所', '還不確定']} value={parkingValue} onChange={(parking) => update({ parking, clearanceUnknown: false })} />
      {session.parking === '不會' && <p className="rounded-xl bg-ok/10 border border-ok/25 p-3 text-xs text-ok">✅ 無特殊限高需求；目前以 {config.generalControlCm} cm 作為業務規劃控制值。</p>}
      {['還不確定', ''].includes(session.parking || '') && <p className="text-xs text-warn">⚠️ 地下室／限高需求待確認。</p>}
    </FieldBlock>
    {limited && <div className="rounded-2xl bg-s2 p-3 space-y-3">
      <FieldBlock label="入口限高">
        <div className="flex flex-wrap gap-2">{quickClearances.map((cm) => <Chip key={cm} active={clearanceMode === cm} onClick={() => update({ clearanceMode: cm, clearanceCm: cm, clearanceUnknown: false })}>{cm} cm</Chip>)}<Chip active={clearanceMode === 'custom'} onClick={() => update({ clearanceMode: 'custom', clearanceCm: quickClearances.includes(String(session.clearanceCm)) ? '' : session.clearanceCm || '', clearanceUnknown: false })}>自訂</Chip><Chip active={clearanceMode === 'unknown'} onClick={() => update({ clearanceMode: 'unknown', clearanceCm: '', clearanceUnknown: true })}>還不知道</Chip></div>
        {clearanceMode === 'custom' && <div className="flex items-center gap-2"><input type="number" inputMode="decimal" min="0" value={session.clearanceCm || ''} onChange={(e) => update({ clearanceMode: 'custom', clearanceCm: e.target.value, clearanceUnknown: false })} placeholder="輸入限高" className="w-40 min-h-11" /><span>cm</span></div>}
        <ChipGroup options={['入口標示', '實際量過', '客戶口述']} value={session.clearanceBasis} onChange={(clearanceBasis) => update({ clearanceBasis })} />
      </FieldBlock>
      <FieldBlock label="安全預留（業務規劃值，不是法律標準）"><div className="flex flex-wrap gap-2">{['5', '10', '15'].map((cm) => <Chip key={cm} active={reserveMode === cm} onClick={() => update({ safetyReserveMode: cm, safetyReserveCm: cm })}>{cm} cm</Chip>)}<Chip active={reserveMode === 'custom'} onClick={() => update({ safetyReserveMode: 'custom', safetyReserveCm: ['5', '10', '15'].includes(String(session.safetyReserveCm)) ? '' : session.safetyReserveCm ?? '' })}>自訂</Chip></div>{reserveMode === 'custom' && <div className="flex items-center gap-2"><input type="number" inputMode="decimal" min="0" value={session.safetyReserveCm ?? ''} onChange={(e) => update({ safetyReserveMode: 'custom', safetyReserveCm: e.target.value })} placeholder="自訂預留" className="w-32" /><span>cm</span></div>}</FieldBlock>
      <p className="rounded-xl bg-warn/10 p-3 text-xs text-warn">地下室標示限高不代表做到同高度就一定能進；仍須確認入口坡度、坡頂角度、地面高低差、空車／載貨狀態及車輛最高點。</p>
    </div>}
    <FieldBlock label="底盤有沒有要做升高？"><ChipGroup options={['原廠高度', '改避震', '加葉片', '避震＋葉片', '還沒決定']} value={session.suspensionPlan} onChange={(suspensionPlan) => update({ suspensionPlan })} /><p className="text-xs text-ink-3">目前參數：避震 +{config.shockLiftCm} cm、葉片 +{config.leafLiftCm} cm；可在設定 → 車高參數修改。</p></FieldBlock>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
      <HeightMetric label="原始貨斗離地" value={plan.baseBedCm} />
      <HeightMetric label="升高後貨斗離地" value={plan.adjustedBedCm} />
      {!limited && <HeightMetric label="目前控制總高" value={plan.controlTotalCm} />}
      {!limited && <HeightMetric label="理論剩餘高度" value={plan.availableCm} />}
    </div>
    {limited && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center"><HeightMetric label="地下室／場所限高" value={plan.clearanceCm} /><HeightMetric label="安全預留" value={plan.reserveCm} /><HeightMetric label="建議控制總高" value={plan.controlTotalCm} /><HeightMetric label="完成後剩餘" value={plan.availableCm} /></div>}
    <p className="text-xs text-ink-3">理論剩餘高度不等於帆布／箱體實際施工尺寸；實際尺寸仍以實車測量為準。</p>
    {Object.entries(plan.itemStatus).map(([name, item]) => <div key={name} className={`rounded-xl border p-3 text-sm ${item.kind === 'danger' ? 'border-danger/40 bg-danger/10 text-danger' : item.kind === 'warning' ? 'border-warn/40 bg-warn/10 text-warn' : item.kind === 'ok' ? 'border-ok/30 bg-ok/10 text-ok' : 'border-bdr bg-s2 text-ink-2'}`}><strong>{name}：{statusLabel(item)}</strong>{item.estimatedTotalCm != null && <p className="text-xs mt-1">預估完工總高約 {item.estimatedTotalCm} cm</p>}{item.missing.length > 0 && <p className="text-xs mt-1">待確認：{item.missing.join('、')}</p>}</div>)}
    <p className="rounded-xl border border-bdr p-3 text-[11px] text-ink-3 leading-relaxed">法規提醒：小型車全高原則為不得超過全寬 1.5 倍，且最高不得超過 2.85 公尺；目前 {config.generalControlCm} cm 是系統規劃控制值，最終仍須依行照車寬、實車最高點、合法車身廠及監理檢驗確認。</p>
  </div>;
}

function HeightMetric({ label, value }) {
  return <div className="rounded-xl bg-s2 p-3"><p className="text-[10px] text-ink-3">{label}</p><strong className="text-base">{value == null ? '待確認' : `約 ${value} cm`}</strong></div>;
}

function RequirementCard({ name, value, session, heightPlan, update, onOpenCatalog }) {
  const hasCases = ['貨斗底板', '帆布', '箱體', '伸縮箱體', '升降尾門', 'H架'].includes(name);
  const [showNote, setShowNote] = useState(!!value.note);
  const heightStatus = heightPlan.itemStatus[name];
  const canConfirm = !heightStatus || heightStatus.canConfirm;
  const displayedStatus = !canConfirm && value.status === '已確認' ? '待確認' : value.status || '考慮中';
  return <div className="rounded-2xl border border-accent/25 bg-accent/5 p-3 space-y-3"><div className="flex items-center justify-between gap-2"><h3 className="font-bold">{name}</h3><div className="flex gap-2 items-center">{hasCases && <button type="button" onClick={onOpenCatalog} className="btn-ghost text-xs">案例</button>}<select value={displayedStatus} onChange={(e) => update({ status: e.target.value === '已確認' && !canConfirm ? '待確認' : e.target.value })} className="text-xs"><option>考慮中</option><option>待確認</option><option disabled={!canConfirm}>已確認</option></select></div></div>{hasCases && <p className="text-[10px] text-ink-3">案例示意，實際尺寸與施工內容依訂單確認。</p>}
    {name === '貨斗底板' && <><FieldBlock label="材質"><ChipGroup options={['橡膠', '白鐵', '鍍鋅鐵板', '其他']} value={value.material} onChange={(material) => update({ material })} /></FieldBlock><FieldBlock label="表面形式"><ChipGroup options={['平板', '花紋／止滑', '其他']} value={value.surface} onChange={(surface) => update({ surface })} /></FieldBlock></>}
    {name === '升降尾門' && <><FieldBlock label="尾門尺寸"><ChipGroup options={['2.5', '3', '3.5', '4', '4.5', '5', '5.5', '6', '特殊']} value={value.size} onChange={(size) => update({ size })} /></FieldBlock>{(parseFloat(value.size) > 4 || value.size === '特殊') && <p className="text-xs text-warn bg-warn/10 rounded-xl p-3">請確認是否需要雙折尾門及實際施工規格；不會自動判定一定要雙折。</p>}<FieldBlock label="主要搬什麼"><ChipGroup options={['一般重物', '機具', '桶裝物', '推車', '棧板', '其他']} value={value.cargoUse} onChange={(cargoUse) => update({ cargoUse })} /></FieldBlock><FieldBlock label="單件最大重量"><ChipGroup options={['100kg內', '100～300kg', '300～500kg', '500kg以上', '不知道']} value={value.maxWeight} onChange={(maxWeight) => update({ maxWeight })} /></FieldBlock><FieldBlock label="使用頻率"><ChipGroup options={['偶爾', '每天', '每天多次', '不確定']} value={value.frequency} onChange={(frequency) => update({ frequency })} /></FieldBlock></>}
    {name === '帆布' && <>
      <FieldBlock label="帆布規格">
        <div className="grid grid-cols-2 gap-2">
          {['標準加高', '標準高', '標準降低', '自訂／其他'].map((option) => <Chip key={option} active={value.canvasSpec === option} onClick={() => update({ canvasSpec: option })}>{option}</Chip>)}
        </div>
        {value.canvasSpec && value.canvasSpec !== '自訂／其他' && <p className="text-xs text-ink-3 mt-2">設定高度：{heightStatus?.bodyHeightCm != null ? `${heightStatus.bodyHeightCm} cm` : '後台尚未設定，暫時不能確認'}</p>}
      </FieldBlock>
      {value.canvasSpec === '自訂／其他' && <FieldBlock label="自訂斗上高度"><div className="flex items-center gap-2"><input type="number" inputMode="decimal" min="0" value={value.customHeightCm || ''} onChange={(e) => update({ customHeightCm: e.target.value })} className="w-36" /><span>cm</span></div></FieldBlock>}
      <FieldBlock label="用途"><ChipGroup options={['遮雨', '防曬', '貨物防護', '工具／材料', '其他']} value={value.use} onChange={(use) => update({ use })} /></FieldBlock>
      <FieldBlock label="開啟方式"><ChipGroup options={['後開', '側開', '多面', '待確認']} value={value.opening} onChange={(opening) => update({ opening })} /></FieldBlock>
      {session.requirements?.['升降尾門']?.selected && <div className="rounded-2xl border border-warn/30 bg-warn/10 p-3 space-y-3">
        <div><p className="text-sm font-bold text-warn">⚠️ 帆布＋尾門五項核對</p><p className="text-xs text-ink-2 mt-1">未全部確認前，帆布不能標示為「已確認」。</p></div>
        <div className="grid sm:grid-cols-2 gap-2">
          {TAILGATE_CANVAS_CHECKS.map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded-xl bg-s1 border border-bdr p-3 text-sm cursor-pointer"><input type="checkbox" checked={!!value.tailgateCoordination?.[key]} onChange={(e) => update({ tailgateCoordination: { ...(value.tailgateCoordination || {}), [key]: e.target.checked } })} /><span>{label}</span></label>)}
        </div>
        <p className="text-xs text-ink-2">自動施工備註：此車有升降尾門，帆布後方尺寸及開口方式須配合尾門設計，並告知帆布廠。</p>
      </div>}
      {heightStatus?.kind === 'danger' && <div className="rounded-2xl border border-danger/35 bg-danger/10 p-3 space-y-2"><p className="text-sm font-bold text-danger">建議下一步</p><div className="flex flex-wrap gap-2"><button type="button" onClick={() => update({ canvasSpec: '標準高' })} className="btn-outline text-xs">改看標準高</button><button type="button" onClick={() => update({ canvasSpec: '標準降低' })} className="btn-outline text-xs">改看標準降低</button><span className="rounded-full border border-bdr bg-s1 px-3 py-2 text-xs">修改底盤方案</span><span className="rounded-full border border-bdr bg-s1 px-3 py-2 text-xs">重新確認地下室高度</span></div></div>}
      <button type="button" onClick={() => setShowNote((current) => !current)} className="btn-outline text-xs">{showNote ? '收起備註' : '＋ 新增備註'}</button>
      {showNote && <textarea value={value.note || ''} onChange={(e) => update({ note: e.target.value })} placeholder="輸入帆布特殊需求，例如後方有尾門、側面掀帆布、地下室入口很斜…" rows={4} className="w-full" />}
    </>}
    {['箱體', '伸縮箱體'].includes(name) && <><FieldBlock label="用途"><ChipGroup options={['工具', '設備', '機具', '一般貨物', '怕雨貨物', '其他']} value={value.use} onChange={(use) => update({ use })} /></FieldBlock><FieldBlock label="開門方式"><ChipGroup options={['後開', '側開', '後＋側', '待確認']} value={value.opening} onChange={(opening) => update({ opening })} /></FieldBlock><FieldBlock label="斗上高度"><div className="flex items-center gap-2"><input type="number" inputMode="decimal" min="0" value={value.bodyHeightCm || ''} onChange={(e) => update({ bodyHeightCm: e.target.value, dimensionsConfirmed: false })} className="w-36" /><span>cm</span></div></FieldBlock><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!value.dimensionsConfirmed} disabled={!canConfirm} onChange={(e) => update({ dimensionsConfirmed: e.target.checked })} />尺寸與高度已確認</label></>}
    {name === 'H架' && <><FieldBlock label="用途"><ChipGroup options={['梯子', '管材', '木料', '鐵料', '其他']} value={value.use} onChange={(use) => update({ use })} /></FieldBlock><FieldBlock label="最大長度"><ChipGroup options={['3m內', '3～4m', '4～5m', '5m以上', '不知道']} value={value.maxLength} onChange={(maxLength) => update({ maxLength })} /></FieldBlock></>}
    {!canConfirm && heightStatus && <p className="rounded-xl bg-warn/10 border border-warn/25 p-3 text-xs text-warn">高度資料尚未完成或可能超高，此項目暫時不能標示「已確認」。</p>}
    {!['貨斗底板', '升降尾門', '帆布', '箱體', '伸縮箱體', 'H架'].includes(name) && <textarea value={value.note || ''} onChange={(e) => update({ note: e.target.value })} placeholder={`${name}需求／規格`} rows={2} className="w-full" />}
  </div>;
}

function VehicleQuickReference() {
  const [drive, setDrive] = useState('2WD');
  const [transmission, setTransmission] = useState('自排');
  const [presentation, setPresentation] = useState(false);
  const [compare, setCompare] = useState([]);
  const variants = VEHICLE_VARIANTS.filter((v) => v.drive === drive && (drive === '4WD' || v.transmission === transmission));
  const comparedVariants = VEHICLE_VARIANTS.filter((v) => compare.includes(v.id));
  const toggleCompare = (id) => setCompare((current) => current.includes(id) ? current.filter((x) => x !== id) : current.length < 2 ? [...current, id] : [current[1], id]);
  if (presentation) return <CustomerPresentation variants={comparedVariants.length ? comparedVariants : variants} onClose={() => setPresentation(false)} />;
  return <section className="card p-4 md:p-6 space-y-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Kia K2500</h2><p className="text-xs text-ink-3 mt-1">3～5 秒找到售價與尺寸；勾選兩台後可並排給客戶比較。</p></div><button onClick={() => setPresentation(true)} className="btn-primary">給客戶看</button></div><div className="flex gap-2 flex-wrap"><Chip active={drive === '2WD'} onClick={() => { setDrive('2WD'); setCompare([]); }}>2WD</Chip><Chip active={drive === '4WD'} onClick={() => { setDrive('4WD'); setCompare([]); }}>4WD</Chip>{drive === '2WD' && <><Chip active={transmission === '自排'} onClick={() => { setTransmission('自排'); setCompare([]); }}>自排</Chip><Chip active={transmission === '手排'} onClick={() => { setTransmission('手排'); setCompare([]); }}>手排</Chip></>}</div><div className="grid md:grid-cols-3 gap-3">{variants.map((v) => <VehicleCard key={v.id} variant={v} checked={compare.includes(v.id)} onCompare={() => toggleCompare(v.id)} />)}</div>{compare.length > 0 && <p className="text-xs text-ink-2 font-medium">已選 {compare.length}/2 台比較；{compare.length === 1 ? '請再勾選另一台。' : '按「給客戶看」只顯示這兩台。'}</p>}</section>;
}

function VehicleCard({ variant: v, checked, onCompare, presentation = false }) {
  const secondary = presentation ? 'text-slate-500' : 'text-ink-2';
  const muted = presentation ? 'text-slate-400' : 'text-ink-3';
  const ureaFillCost = v.ureaTankL * v.ureaPricePerL;
  return <article className={`rounded-2xl border ${presentation ? 'bg-white border-slate-200 text-slate-800' : checked ? 'bg-accent/15 border-accent text-ink' : 'bg-s2 border-bdr/70 text-ink'} p-4`}><div className="flex items-start justify-between gap-3"><div><p className={`text-xs ${secondary}`}>{v.drive}・{v.transmissionLabel}</p><h3 className="text-lg font-bold mt-1">{v.cab}</h3></div>{!presentation && <label className="text-sm font-semibold flex items-center gap-2 min-h-10 cursor-pointer"><input type="checkbox" checked={checked} onChange={onCompare} />比較</label>}</div><div className="mt-4"><p className={`text-xs ${secondary}`}>售價</p><strong className="text-3xl tracking-tight">{formatVehiclePrice(v.msrpTwd)}</strong><p className={`text-xs ${muted}`}>{formatTwd(v.msrpTwd)}</p></div><div className="grid grid-cols-2 gap-3 mt-5"><Metric label="貨斗長" big={`${convertMmToTaiwaneseChi(v.cargoLengthMm)} 台尺`} small={`${v.cargoLengthMm.toLocaleString()} mm`} presentation={presentation} /><Metric label="車長" big={`${convertMmToTaiwaneseChi(v.lengthMm)} 台尺`} small={`${v.lengthMm.toLocaleString()} mm`} presentation={presentation} /><Metric label="車高" big={`${convertMmToTaiwaneseChi(v.heightMm)} 台尺`} small={`${v.heightMm.toLocaleString()} mm`} presentation={presentation} /><Metric label="載重" big={`${v.payloadKg.toLocaleString()} kg`} small="核定載重" presentation={presentation} /><Metric label="座位" big={`${v.seats} 人`} presentation={presentation} /><Metric label="平均油耗測試值" big={`${v.fuelEconomyKmL} km/L`} presentation={presentation} /><Metric label="柴油油箱" big={`${v.fuelTankL} 公升`} presentation={presentation} /><Metric label="滿油估算續航" big={`約 ${v.estimatedRangeKm} km`} small={`${v.transmission}實際使用估算`} presentation={presentation} /></div><details className="mt-4"><summary className="text-sm font-semibold cursor-pointer">更多規格</summary><div className={`mt-3 text-xs space-y-1 ${presentation ? 'text-slate-600' : 'text-ink-2'}`}><p>尿素桶 {v.ureaTankL} 公升・尿素約 NT$ {v.ureaPricePerL}/公升・加滿約 NT$ {ureaFillCost.toLocaleString('zh-TW')}</p><p>貨斗寬 {v.cargoWidthMm.toLocaleString()} mm</p><p>空車重 {v.curbWeightKg.toLocaleString()} kg・總重 {v.grossVehicleWeightKg.toLocaleString()} kg</p><p>排氣量 {v.displacementCc.toLocaleString()} c.c.</p><p>最大馬力 {v.maxPower}</p><p>最大扭力 {v.maxTorque}</p><p>最小迴轉半徑 {v.turningRadiusM} m</p>{v.differentialLock && <p>{v.differentialLock}</p>}</div></details></article>;
}

function Metric({ label, big, small, presentation = false }) { return <div><p className={`text-[10px] ${presentation ? 'text-slate-500' : 'text-ink-2'}`}>{label}</p><strong className="text-base block">{big}</strong>{small && <span className={`text-[10px] ${presentation ? 'text-slate-400' : 'text-ink-3'}`}>{small}</span>}</div>; }

function CustomerPresentation({ variants, onClose }) {
  return <div className="safe-screen fixed inset-0 z-[80] bg-white overflow-y-auto text-slate-900"><div className="max-w-5xl mx-auto p-4 md:p-8"><div className="flex items-center justify-between mb-6"><h1 className="text-3xl font-black">Kia K2500</h1><button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm">關閉展示</button></div><div className={`grid gap-4 ${variants.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>{variants.map((v) => <VehicleCard key={v.id} variant={v} presentation />)}</div><p className="text-xs text-slate-400 mt-6">平均油耗為測試值；滿油續航與尿素價格為目前使用估算，不是保證值。實際結果會受載重、路況、駕駛方式、速度、改裝、環境及購買地點影響。</p></div></div>;
}

function FormalizeModal({ form, setForm, onClose, onSave }) {
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  return <><div className="overlay" onClick={onClose} /><div className="modal"><div className="safe-screen bg-s1 rounded-2xl border border-bdr shadow-panel w-full max-w-lg max-h-[92dvh] overflow-y-auto p-5 z-50"><h2 className="text-lg font-bold">正式建檔</h2><p className="text-xs text-ink-3 mt-1">接待紀錄會全部帶入，不必重新問一次。</p><div className="grid grid-cols-2 gap-3 mt-5">{[['name', '姓名／公司名 *'], ['phone', '電話'], ['lineId', 'LINE'], ['company', '公司名稱'], ['address', '地址'], ['budget', '預算'], ['purchaseTime', '購車時間'], ['payment', '付款方式'], ['loanNeed', '貸款需求'], ['nextDate', '下次追蹤日期']].map(([key, label]) => <label key={key} className={key === 'address' ? 'col-span-2' : ''}><span className="text-xs text-ink-3">{label}</span><input type={key === 'nextDate' ? 'date' : 'text'} value={form[key]} onChange={(e) => set(key, e.target.value)} className="w-full min-h-11 mt-1" /></label>)}</div><div className="flex gap-2 mt-5"><button onClick={onClose} className="btn-outline flex-1">取消</button><button onClick={onSave} disabled={!form.name.trim()} className="btn-primary flex-1 disabled:opacity-40">建立客戶並追蹤</button></div></div></div></>;
}

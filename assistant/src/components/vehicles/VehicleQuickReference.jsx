import { useState } from 'react';
import {
  VEHICLE_VARIANTS, convertMmToTaiwaneseChi, formatTwd, formatVehiclePrice,
} from '../../utils/vehicles';

const CHIP = 'min-h-11 rounded-xl border px-3 py-2 text-sm transition-colors text-left';

function Chip({ active, children, onClick }) {
  return <button type="button" onClick={onClick} className={`${CHIP} ${active ? 'bg-accent text-on-accent border-accent font-semibold' : 'bg-s1 text-ink-2 border-bdr hover:border-accent/60'}`}>{children}</button>;
}

// K2500 規格速查與兩車比較（工具選單用）。原本放在已停用的客戶接待頁，2026-11-18 清理時獨立出來。
export default function VehicleQuickReference() {
  const [drive, setDrive] = useState('2WD');
  const [transmission, setTransmission] = useState('自排');
  const [presentation, setPresentation] = useState(false);
  const [compare, setCompare] = useState([]);
  const variants = VEHICLE_VARIANTS.filter((v) => v.drive === drive && (drive === '4WD' || v.transmission === transmission));
  const comparedVariants = VEHICLE_VARIANTS.filter((v) => compare.includes(v.id));
  const comparedNames = comparedVariants.map((v) => v.shortName || v.name).join('、');
  const toggleCompare = (id) => setCompare((current) => current.includes(id) ? current.filter((x) => x !== id) : current.length < 2 ? [...current, id] : [current[1], id]);
  if (presentation) return <CustomerPresentation variants={comparedVariants.length ? comparedVariants : variants} onClose={() => setPresentation(false)} />;
  return <section className="card p-4 md:p-6 space-y-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Kia K2500</h2><p className="text-xs text-ink-3 mt-1">可跨 2WD、4WD 勾選兩台，再逐項比較規格。</p></div><button disabled={compare.length !== 2} onClick={() => setPresentation(true)} className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">車款比較</button></div><div className="flex gap-2 flex-wrap"><Chip active={drive === '2WD'} onClick={() => setDrive('2WD')}>2WD</Chip><Chip active={drive === '4WD'} onClick={() => setDrive('4WD')}>4WD</Chip>{drive === '2WD' && <><Chip active={transmission === '自排'} onClick={() => setTransmission('自排')}>自排</Chip><Chip active={transmission === '手排'} onClick={() => setTransmission('手排')}>手排</Chip></>}</div><div className="grid md:grid-cols-3 gap-3">{variants.map((v) => <VehicleCard key={v.id} variant={v} checked={compare.includes(v.id)} onCompare={() => toggleCompare(v.id)} />)}</div>{compare.length > 0 && <div className="rounded-xl border border-accent/25 bg-accent/5 px-3 py-2 text-xs text-ink-2"><strong>已選 {compare.length}/2 台：</strong>{comparedNames}<span className="block mt-1 text-ink-3">{compare.length === 1 ? '切換 2WD／4WD 或自排／手排，再勾選另一台。' : '按「車款比較」逐項查看差異。'}</span></div>}</section>;
}

function VehicleCard({ variant: v, checked, onCompare, presentation = false }) {
  const secondary = presentation ? 'text-slate-500' : 'text-ink-2';
  const muted = presentation ? 'text-slate-400' : 'text-ink-3';
  const ureaFillCost = v.ureaTankL * v.ureaPricePerL;
  return <article className={`rounded-2xl border ${presentation ? 'bg-white border-slate-200 text-slate-800' : checked ? 'bg-accent/15 border-accent text-ink' : 'bg-s2 border-bdr/70 text-ink'} p-4`}><div className="flex items-start justify-between gap-3"><div><p className={`text-xs ${secondary}`}>{v.drive}・{v.transmissionLabel}</p><h3 className="text-lg font-bold mt-1">{v.cab}</h3></div>{!presentation && <label className="text-sm font-semibold flex items-center gap-2 min-h-10 cursor-pointer"><input type="checkbox" checked={checked} onChange={onCompare} />比較</label>}</div><div className="mt-4"><p className={`text-xs ${secondary}`}>售價</p><strong className="text-3xl tracking-tight">{formatVehiclePrice(v.msrpTwd)}</strong><p className={`text-xs ${muted}`}>{formatTwd(v.msrpTwd)}</p></div><div className="grid grid-cols-2 gap-3 mt-5"><Metric label="貨斗長" big={`${convertMmToTaiwaneseChi(v.cargoLengthMm)} 台尺`} small={`${v.cargoLengthMm.toLocaleString()} mm`} presentation={presentation} /><Metric label="車長" big={`${convertMmToTaiwaneseChi(v.lengthMm)} 台尺`} small={`${v.lengthMm.toLocaleString()} mm`} presentation={presentation} /><Metric label="車高" big={`${convertMmToTaiwaneseChi(v.heightMm)} 台尺`} small={`${v.heightMm.toLocaleString()} mm`} presentation={presentation} /><Metric label="載重" big={`${v.payloadKg.toLocaleString()} kg`} small="核定載重" presentation={presentation} /><Metric label="座位" big={`${v.seats} 人`} presentation={presentation} /><Metric label="平均油耗測試值" big={`${v.fuelEconomyKmL} km/L`} presentation={presentation} /><Metric label="柴油油箱" big={`${v.fuelTankL} 公升`} presentation={presentation} /><Metric label="滿油估算續航" big={`約 ${v.estimatedRangeKm} km`} small={`${v.transmission}實際使用估算`} presentation={presentation} /></div><details className="mt-4"><summary className="text-sm font-semibold cursor-pointer">更多規格</summary><div className={`mt-3 text-xs space-y-1 ${presentation ? 'text-slate-600' : 'text-ink-2'}`}><p>尿素桶 {v.ureaTankL} 公升・尿素約 NT$ {v.ureaPricePerL}/公升・加滿約 NT$ {ureaFillCost.toLocaleString('zh-TW')}</p><p>貨斗寬 {v.cargoWidthMm.toLocaleString()} mm</p><p>空車重 {v.curbWeightKg.toLocaleString()} kg・總重 {v.grossVehicleWeightKg.toLocaleString()} kg</p><p>排氣量 {v.displacementCc.toLocaleString()} c.c.</p><p>最大馬力 {v.maxPower}</p><p>最大扭力 {v.maxTorque}</p><p>最小迴轉半徑 {v.turningRadiusM} m</p>{v.differentialLock && <p>{v.differentialLock}</p>}</div></details></article>;
}

function Metric({ label, big, small, presentation = false }) { return <div><p className={`text-[10px] ${presentation ? 'text-slate-500' : 'text-ink-2'}`}>{label}</p><strong className="text-base block">{big}</strong>{small && <span className={`text-[10px] ${presentation ? 'text-slate-400' : 'text-ink-3'}`}>{small}</span>}</div>; }

function CustomerPresentation({ variants, onClose }) {
  const rows = [
    ['正式售價', (v) => <><strong className="text-xl text-slate-900">{formatVehiclePrice(v.msrpTwd)}</strong><span className="block text-xs text-slate-400">{formatTwd(v.msrpTwd)}</span></>],
    ['驅動方式', (v) => `${v.drive}・${v.driveLabel}`],
    ['變速系統', (v) => v.transmissionLabel],
    ['乘坐人數', (v) => `${v.seats} 人`],
    ['核定載重', (v) => `${v.payloadKg.toLocaleString()} kg`],
    ['貨斗長度', (v) => `${convertMmToTaiwaneseChi(v.cargoLengthMm)} 台尺／${v.cargoLengthMm.toLocaleString()} mm`],
    ['貨斗寬度', (v) => `${v.cargoWidthMm.toLocaleString()} mm`],
    ['貨斗離地', (v) => `${v.cargoFloorHeightMm.toLocaleString()} mm`],
    ['車身長度', (v) => `${convertMmToTaiwaneseChi(v.lengthMm)} 台尺／${v.lengthMm.toLocaleString()} mm`],
    ['車身高度', (v) => `${convertMmToTaiwaneseChi(v.heightMm)} 台尺／${v.heightMm.toLocaleString()} mm`],
    ['平均油耗測試值', (v) => `${v.fuelEconomyKmL} km/L`],
    ['滿油估算續航', (v) => `約 ${v.estimatedRangeKm} km`],
    ['最小迴轉半徑', (v) => `${v.turningRadiusM} m`],
    ['四驅配備', (v) => v.differentialLock || '—'],
  ];
  return <div className="safe-screen fixed inset-0 z-[80] bg-white overflow-y-auto text-slate-900"><div className="max-w-6xl mx-auto p-4 md:p-8"><div className="flex items-center justify-between gap-4 mb-3"><div><p className="text-xs font-semibold tracking-[0.2em] text-orange-600">KIA K2500</p><h1 className="text-2xl md:text-3xl font-black mt-1">車款比較</h1></div><button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm shrink-0">返回車型</button></div><p className="text-xs text-slate-500 mb-4 md:hidden">← 左右滑動查看兩台車 →</p><div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm"><div className="min-w-[680px] grid grid-cols-[140px_repeat(2,minmax(250px,1fr))] bg-white"><div className="sticky left-0 z-10 bg-slate-100 border-b border-r border-slate-200 p-4 text-xs font-semibold text-slate-500 flex items-end">比較項目</div>{variants.map((v) => <div key={v.id} className="bg-slate-900 text-white border-b border-r border-slate-700 p-4"><p className="text-xs text-orange-300">{v.drive}・{v.transmissionLabel}</p><strong className="block text-xl mt-1">{v.cab} {v.seats}人座</strong></div>)}{rows.map(([label, render]) => <div key={label} className="contents"><div className="sticky left-0 z-10 bg-slate-50 border-b border-r border-slate-200 p-4 text-xs font-semibold text-slate-500">{label}</div>{variants.map((v) => <div key={`${label}-${v.id}`} className="border-b border-r border-slate-200 p-4 text-sm font-medium text-slate-700">{render(v)}</div>)}</div>)}</div></div><p className="text-xs text-slate-400 mt-5">平均油耗為測試值；滿油續航與尿素價格為目前使用估算，不是保證值。實際結果會受載重、路況、駕駛方式、速度、改裝、環境及購買地點影響。</p></div></div>;
}


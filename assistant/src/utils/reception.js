export const RECEPTION_INDUSTRIES = ['水電', '冷氣', '工程', '鐵工', '建築', '裝潢', '木工', '物流', '農業', '市場／攤販', '回收', '食品', '設備'];
export const CURRENT_VEHICLES = ['Kia K2500', '得利卡', '小霸王', '菱利', 'HINO', '其他貨車', '目前沒有貨車'];
export const CARGO_OPTIONS = ['工具', '材料', '機具', '設備', '一般貨物', '農產品', '桶裝物', '長料', '棧板'];
export const LOAD_OPTIONS = ['500kg內', '約1噸', '1～1.5噸', '1.5～2噸', '2噸以上', '不知道'];
export const DRIVER_OPTIONS = ['本人', '師傅／員工', '共同使用', '家人', '其他'];
export const RIDER_OPTIONS = ['1～2人', '3人', '4人以上', '不一定'];
export const REASON_OPTIONS = ['舊車老化', '維修變多', '載重不夠', '貨斗／空間不足', '需要多人乘坐', '工作量增加', '增購車輛', '第一次買貨車', '朋友／同行推薦', '網路看到 Kia K2500', '正在比較其他品牌'];
export const ENVIRONMENT_OPTIONS = ['市區', '一般道路', '高速公路', '工地', '山路', '農路', '長途／南北跑', '巷弄', '地下室／室內停車場'];
export const REQUIREMENT_TYPES = ['貨斗底板', '帆布', '箱體', '伸縮箱體', '升降尾門', 'H架', '側踏', '防護配件', '燈具', '其他'];

export const DEFAULT_HEIGHT_CONFIG = {
  key: 'heightConfig',
  bedHeight2wdCm: 77,
  bedHeight4wdCm: 85.5,
  shockLiftCm: 5,
  leafLiftCm: 2,
  generalControlCm: 270,
  basementReserveCm: 10,
  nearLimitCm: 5,
  canvasRaisedCm: '',
  canvasStandardCm: '',
  canvasLoweredCm: '',
};

export function normalizeHeightConfig(row = {}) {
  const numberOr = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const optionalNumber = (value) => value === '' || value == null ? '' : numberOr(value, '');
  return {
    key: 'heightConfig',
    bedHeight2wdCm: numberOr(row.bedHeight2wdCm, DEFAULT_HEIGHT_CONFIG.bedHeight2wdCm),
    bedHeight4wdCm: numberOr(row.bedHeight4wdCm, DEFAULT_HEIGHT_CONFIG.bedHeight4wdCm),
    shockLiftCm: numberOr(row.shockLiftCm, DEFAULT_HEIGHT_CONFIG.shockLiftCm),
    leafLiftCm: numberOr(row.leafLiftCm, DEFAULT_HEIGHT_CONFIG.leafLiftCm),
    generalControlCm: numberOr(row.generalControlCm, DEFAULT_HEIGHT_CONFIG.generalControlCm),
    basementReserveCm: numberOr(row.basementReserveCm, DEFAULT_HEIGHT_CONFIG.basementReserveCm),
    nearLimitCm: numberOr(row.nearLimitCm, DEFAULT_HEIGHT_CONFIG.nearLimitCm),
    canvasRaisedCm: optionalNumber(row.canvasRaisedCm),
    canvasStandardCm: optionalNumber(row.canvasStandardCm),
    canvasLoweredCm: optionalNumber(row.canvasLoweredCm),
  };
}

export const HEIGHT_TRIGGER_REQUIREMENTS = ['帆布', '箱體', '伸縮箱體', '升降尾門'];

export function requiresHeightPlanning(session) {
  const req = session?.requirements || {};
  return HEIGHT_TRIGGER_REQUIREMENTS.some((name) => req[name]?.selected);
}

function hasHeightLimit(parking) {
  return ['會', '會下地下室', '有其他限高場所'].includes(parking);
}

function selectedCanvasHeight(detail = {}, config) {
  if (detail.canvasSpec === '標準加高') return config.canvasRaisedCm;
  if (detail.canvasSpec === '標準高') return config.canvasStandardCm;
  if (detail.canvasSpec === '標準降低') return config.canvasLoweredCm;
  if (detail.canvasSpec === '自訂／其他') return detail.customHeightCm;
  return '';
}

export function heightPlanning(session, variant, rawConfig = DEFAULT_HEIGHT_CONFIG) {
  const config = normalizeHeightConfig(rawConfig);
  const req = session?.requirements || {};
  const triggered = requiresHeightPlanning(session);
  const drive = variant?.drive || (['2WD', '4WD'].includes(session?.driveNeed) ? session.driveNeed : '');
  const baseBedCm = drive === '4WD' ? config.bedHeight4wdCm : drive === '2WD' ? config.bedHeight2wdCm : null;
  const suspension = session?.suspensionPlan || '';
  const suspensionKnown = !!suspension && suspension !== '還沒決定';
  const shockLiftCm = ['改避震', '避震＋葉片'].includes(suspension) ? config.shockLiftCm : 0;
  const leafLiftCm = ['加葉片', '避震＋葉片'].includes(suspension) ? config.leafLiftCm : 0;
  const adjustedBedCm = baseBedCm == null ? null : Math.round((baseBedCm + shockLiftCm + leafLiftCm) * 10) / 10;
  const parking = session?.parking || '';
  const parkingKnown = !!parking && !['不確定', '還不確定'].includes(parking);
  const limited = hasHeightLimit(parking);
  const clearanceCm = Number(session?.clearanceCm) || null;
  const reserveCm = Number(session?.safetyReserveCm || config.basementReserveCm);
  const controlTotalCm = limited ? (clearanceCm ? clearanceCm - reserveCm : null) : parkingKnown ? config.generalControlCm : null;
  const availableCm = controlTotalCm != null && adjustedBedCm != null
    ? Math.round((controlTotalCm - adjustedBedCm) * 10) / 10 : null;
  const missingBase = [];
  if (!drive) missingBase.push('K2500 2WD／4WD 車型');
  if (!parkingKnown) missingBase.push('地下室／限高需求');
  if (limited && !clearanceCm) missingBase.push('實際限高高度');
  if (!suspensionKnown) missingBase.push('避震／葉片升高方案');

  const itemStatus = {};
  for (const name of HEIGHT_TRIGGER_REQUIREMENTS) {
    const detail = req[name];
    if (!detail?.selected) continue;
    const missing = [...missingBase];
    let bodyHeightCm = null;
    if (name === '帆布') {
      if (!detail.canvasSpec) missing.push('帆布規格');
      const value = selectedCanvasHeight(detail, config);
      bodyHeightCm = Number(value) || null;
      if (detail.canvasSpec && !bodyHeightCm) missing.push(detail.canvasSpec === '自訂／其他' ? '自訂帆布高度' : `${detail.canvasSpec}後台高度`);
    }
    if (['箱體', '伸縮箱體'].includes(name)) {
      bodyHeightCm = Number(detail.bodyHeightCm) || null;
      if (!bodyHeightCm) missing.push(`${name}斗上高度`);
    }
    const estimatedTotalCm = bodyHeightCm != null && adjustedBedCm != null
      ? Math.round((bodyHeightCm + adjustedBedCm) * 10) / 10 : null;
    const marginCm = estimatedTotalCm != null && controlTotalCm != null
      ? Math.round((controlTotalCm - estimatedTotalCm) * 10) / 10 : null;
    const kind = missing.length > 0 ? 'pending' : marginCm == null ? 'ok' : marginCm < 0 ? 'danger' : marginCm <= config.nearLimitCm ? 'warning' : 'ok';
    itemStatus[name] = {
      missing: [...new Set(missing)], bodyHeightCm, estimatedTotalCm, marginCm, kind,
      canConfirm: missing.length === 0 && kind !== 'danger',
    };
  }
  const allMissing = Object.values(itemStatus).flatMap((item) => item.missing);
  return {
    triggered, drive, baseBedCm, shockLiftCm, leafLiftCm, adjustedBedCm,
    parkingKnown, limited, clearanceCm, reserveCm, controlTotalCm, availableCm,
    missing: [...new Set(allMissing.length ? allMissing : missingBase)], itemStatus,
  };
}

export function heightPlanSummary(session, variant, config) {
  const plan = heightPlanning(session, variant, config);
  if (!plan.triggered) return '';
  const req = session?.requirements || {};
  const canvas = req['帆布'] || {};
  const bodyLines = ['帆布', '箱體', '伸縮箱體'].filter((name) => req[name]?.selected).map((name) => {
    const detail = req[name] || {};
    const item = plan.itemStatus[name];
    const label = name === '帆布' ? (detail.canvasSpec || '規格待確認') : name;
    return `${name}：${label}／斗上 ${item?.bodyHeightCm || '高度待確認'} cm／預估完工總高 ${item?.estimatedTotalCm || '待確認'} cm`;
  });
  const tailgate = req['升降尾門'] || {};
  const selectedItems = HEIGHT_TRIGGER_REQUIREMENTS.filter((name) => req[name]?.selected).join('、');
  const statusKinds = Object.values(plan.itemStatus).map((item) => item.kind);
  const status = statusKinds.includes('danger') ? '⛔ 可能超高' : plan.missing.length ? '⚠️ 待確認' : '✅ 可規劃';
  return [
    '【車高／施工交接】',
    `項目：${selectedItems || '—'}`,
    `車型：${plan.drive || '待確認'}`,
    `地下室／限高：${plan.limited ? `${plan.clearanceCm || '待確認'} cm（預留 ${plan.reserveCm} cm）` : session?.parking || '待確認'}`,
    `底盤：${session?.suspensionPlan || '待確認'}（避震 +${plan.shockLiftCm} cm／葉片 +${plan.leafLiftCm} cm）`,
    `貨斗離地：約 ${plan.adjustedBedCm ?? '待確認'} cm`,
    `控制總高：約 ${plan.controlTotalCm ?? '待確認'} cm`,
    `理論剩餘高度：約 ${plan.availableCm ?? '待確認'} cm`,
    ...bodyLines,
    tailgate.selected ? `尾門：${tailgate.size || '尺寸待確認'}尺／${tailgate.maxWeight || '承重待確認'}` : '',
    canvas.note ? `帆布備註：${canvas.note}` : '',
    `狀態：${status}`,
    '實際尺寸仍以實車、合法車身廠及監理檢驗確認為準。',
  ].filter(Boolean).join('\n');
}

export function newReceptionSession(sequence = 1) {
  const now = new Date().toISOString();
  return {
    id: `reception-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    displayName: `展間客戶 #${String(sequence).padStart(3, '0')}`,
    status: 'active',
    source: '現場接待',
    customerMode: '新車＋改裝',
    industry: '', currentVehicle: '', cargo: [], loadRange: '', loadKg: '', driver: '', riders: '',
    reasons: [], painPoint: '', environments: [], parking: '', clearanceCm: '', clearanceBasis: '', safetyReserveCm: 10, suspensionPlan: '',
    longMaterial: '不會', longMaterialTypes: [], longMaterialLength: '', longMaterialMeters: '',
    cabNeed: '', driveNeed: '', transmissionNeed: '', vehicleVariantId: '',
    requirements: {}, quickNote: '', handoffNote: '',
    createdAt: now, updatedAt: now,
  };
}

export function toggleListValue(list, value) {
  const current = Array.isArray(list) ? list : [];
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

export function requirementPendingItems(session, variant = null, config = DEFAULT_HEIGHT_CONFIG) {
  const req = session?.requirements || {};
  const pending = [];
  if (req['升降尾門']?.selected && !req['升降尾門']?.size) pending.push('尾門尺寸');
  if (req['升降尾門']?.selected && !req['升降尾門']?.maxWeight) pending.push('尾門實際承重規格');
  if (req['升降尾門']?.selected && (parseFloat(req['升降尾門']?.size) > 4 || req['升降尾門']?.size === '特殊')) pending.push('是否需雙折尾門');
  if (req['帆布']?.selected && !req['帆布']?.canvasSpec) pending.push('帆布規格');
  if (req['升降尾門']?.selected && req['帆布']?.selected) pending.push('後方帆布與尾門配置');
  if (req['H架']?.selected && !req['H架']?.maxLength) pending.push('H架最終高度／長料配置');
  if (req['箱體']?.selected && !req['箱體']?.dimensionsConfirmed) pending.push('箱體完成尺寸與高度');
  if (req['伸縮箱體']?.selected && !req['伸縮箱體']?.dimensionsConfirmed) pending.push('伸縮箱體完成尺寸與高度');
  if (requiresHeightPlanning(session)) {
    const plan = heightPlanning(session, variant, config);
    pending.push(...plan.missing);
    for (const [name, status] of Object.entries(plan.itemStatus)) {
      if (status.kind === 'danger') pending.push(`${name}預估超過高度限制`);
    }
  }
  return [...new Set(pending)];
}

export function dependencyReminders(session, variant = null, config = DEFAULT_HEIGHT_CONFIG) {
  const req = session?.requirements || {};
  const tailgate = req['升降尾門']?.selected;
  const canvas = req['帆布']?.selected;
  const box = req['箱體']?.selected;
  const rack = req['H架']?.selected;
  const limited = hasHeightLimit(session?.parking);
  const reminders = [];
  if (tailgate && canvas) reminders.push('此車有升降尾門，帆布後方施工與骨架需配合尾門，避免升降干涉。');
  if (canvas && limited) reminders.push(`帆布骨架高度需配合客戶限高${session.clearanceCm ? ` ${session.clearanceCm}cm` : ''}；完成車高度待確認。`);
  if (tailgate && limited) reminders.push('尾門施工後仍需確認完成車高度與進出動線。');
  if (canvas && rack) reminders.push('請確認 H架 與帆布骨架配置。');
  if (canvas && rack && limited) reminders.push('需確認 H架、帆布骨架與完成車高度。');
  if (tailgate && box) reminders.push('箱體後方開口、尾門平台與升降動線需確認是否干涉。');
  if (requiresHeightPlanning(session)) {
    reminders.unshift('加裝帆布、箱體或尾門前，必須先確認是否改避震（預設 +5 cm）或加葉片（預設 +2 cm），再計算完成車高度。');
    const plan = heightPlanning(session, variant, config);
    if (plan.limited) reminders.push('地下室標示限高不代表做到同高度就一定能進，仍須考慮入口坡度、坡頂角度、載重狀態及車輛最高點。');
    for (const [name, status] of Object.entries(plan.itemStatus)) {
      if (status.kind === 'danger') reminders.push(`${name}目前預估超高 ${Math.abs(status.marginCm)} cm，不能標示為已確認。`);
    }
  }
  return [...new Set(reminders)];
}

export function receptionPromptStatus(session) {
  return [
    ['做什麼', !!session.industry], ['開什麼', !!session.currentVehicle], ['載什麼', (session.cargo || []).length > 0],
    ['誰開', !!session.driver], ['為什麼換', (session.reasons || []).length > 0], ['跑哪裡', (session.environments || []).length > 0],
  ];
}

export function heightAssessment(session, variant) {
  if (!variant || session?.parking !== '會' || !Number(session?.clearanceCm)) return null;
  const req = session.requirements || {};
  const alteredHeight = ['帆布', '箱體', 'H架'].some((name) => req[name]?.selected);
  const clearance = Number(session.clearanceCm);
  const vehicleCm = variant.heightMm / 10;
  return {
    clearanceCm: clearance,
    vehicleCm,
    differenceCm: Math.round((clearance - vehicleCm) * 10) / 10,
    status: alteredHeight ? '完成車高度待確認' : vehicleCm >= clearance ? '高度需確認' : '原車高度尚有空間',
    alteredHeight,
  };
}

export function requirementSummary(session) {
  const req = session?.requirements || {};
  return Object.entries(req).filter(([, item]) => item?.selected).map(([name, item]) => {
    if (name === '貨斗底板') {
      const surface = item.surface === '花紋／止滑' ? '花紋板' : item.surface;
      return `${item.material || '材質待確認'}／${surface || '表面待確認'}`;
    }
    if (name === '升降尾門') return `${item.size || '尺寸待確認'}尺升降尾門`;
    if (name === '帆布') {
      const height = Number(item.customHeightCm) || null;
      return `帆布（${item.canvasSpec || '規格待確認'}${height ? `／斗上 ${height}cm` : ''}）`;
    }
    if (['箱體', '伸縮箱體'].includes(name)) {
      const height = Number(item.bodyHeightCm) || null;
      return `${name}${height ? `（斗上 ${height}cm）` : ''}`;
    }
    return name;
  });
}

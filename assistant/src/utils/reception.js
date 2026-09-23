export const RECEPTION_INDUSTRIES = ['水電', '冷氣', '工程', '鐵工', '建築', '裝潢', '木工', '物流', '農業', '市場／攤販', '回收', '食品', '設備'];
export const CURRENT_VEHICLES = ['Kia K2500', '得利卡', '小霸王', '菱利', 'HINO', '其他貨車', '目前沒有貨車'];
export const CARGO_OPTIONS = ['工具', '材料', '機具', '設備', '一般貨物', '農產品', '桶裝物', '長料', '棧板'];
export const LOAD_OPTIONS = ['500kg內', '約1噸', '1～1.5噸', '1.5～2噸', '2噸以上', '不知道'];
export const DRIVER_OPTIONS = ['本人', '師傅／員工', '共同使用', '家人', '其他'];
export const RIDER_OPTIONS = ['1～2人', '3人', '4人以上', '不一定'];
export const REASON_OPTIONS = ['舊車老化', '維修變多', '載重不夠', '貨斗／空間不足', '需要多人乘坐', '工作量增加', '增購車輛', '第一次買貨車', '朋友／同行推薦', '網路看到 Kia K2500', '正在比較其他品牌'];
export const ENVIRONMENT_OPTIONS = ['市區', '一般道路', '高速公路', '工地', '山路', '農路', '長途／南北跑', '巷弄', '地下室／室內停車場'];
export const REQUIREMENT_TYPES = ['貨斗底板', '帆布', '箱體', '升降尾門', 'H架', '側踏', '防護配件', '燈具', '其他'];

export function newReceptionSession(sequence = 1) {
  const now = new Date().toISOString();
  return {
    id: `reception-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    displayName: `展間客戶 #${String(sequence).padStart(3, '0')}`,
    status: 'active',
    source: '現場接待',
    customerMode: '新車＋改裝',
    industry: '', currentVehicle: '', cargo: [], loadRange: '', loadKg: '', driver: '', riders: '',
    reasons: [], painPoint: '', environments: [], parking: '', clearanceCm: '', clearanceBasis: '',
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

export function requirementPendingItems(session) {
  const req = session?.requirements || {};
  const pending = [];
  if (req['升降尾門']?.selected && !req['升降尾門']?.size) pending.push('尾門尺寸');
  if (req['升降尾門']?.selected && !req['升降尾門']?.maxWeight) pending.push('尾門實際承重規格');
  if (req['升降尾門']?.selected && (parseFloat(req['升降尾門']?.size) > 4 || req['升降尾門']?.size === '特殊')) pending.push('是否需雙折尾門');
  if (req['帆布']?.selected && !req['帆布']?.frameHeight) pending.push('帆布完成高度');
  if (req['升降尾門']?.selected && req['帆布']?.selected) pending.push('後方帆布與尾門配置');
  if (req['H架']?.selected && !req['H架']?.maxLength) pending.push('H架最終高度／長料配置');
  if (req['箱體']?.selected && !req['箱體']?.dimensionsConfirmed) pending.push('箱體完成尺寸與高度');
  return [...new Set(pending)];
}

export function dependencyReminders(session) {
  const req = session?.requirements || {};
  const tailgate = req['升降尾門']?.selected;
  const canvas = req['帆布']?.selected;
  const box = req['箱體']?.selected;
  const rack = req['H架']?.selected;
  const limited = session?.parking === '會';
  const reminders = [];
  if (tailgate && canvas) reminders.push('此車有升降尾門，帆布後方施工與骨架需配合尾門，避免升降干涉。');
  if (canvas && limited) reminders.push(`帆布骨架高度需配合客戶限高${session.clearanceCm ? ` ${session.clearanceCm}cm` : ''}；完成車高度待確認。`);
  if (tailgate && limited) reminders.push('尾門施工後仍需確認完成車高度與進出動線。');
  if (canvas && rack) reminders.push('請確認 H架 與帆布骨架配置。');
  if (canvas && rack && limited) reminders.push('需確認 H架、帆布骨架與完成車高度。');
  if (tailgate && box) reminders.push('箱體後方開口、尾門平台與升降動線需確認是否干涉。');
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
    return name;
  });
}

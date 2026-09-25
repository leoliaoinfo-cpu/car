export const CORE_TRUCK_METRICS = [
  { key: 'vehicle_height_mm', label: '整車車高', unit: 'mm' },
  { key: 'vehicle_width_mm', label: '整車車寬', unit: 'mm' },
  { key: 'bed_length_mm', label: '貨斗長度', unit: 'mm' },
  { key: 'payload_kg', label: '合法載重', unit: 'kg' },
  { key: 'power_ps', label: '最大馬力', unit: 'PS' },
  { key: 'torque_kgm', label: '最大扭力', unit: 'kg-m' },
];

export const DETAIL_TRUCK_METRICS = [
  { key: 'vehicle_length_mm', label: '整車長度', unit: 'mm' },
  { key: 'bed_width_mm', label: '貨斗寬度', unit: 'mm' },
  { key: 'bed_loading_height_mm', label: '貨台離地高', unit: 'mm' },
  { key: 'gross_vehicle_weight_kg', label: '車輛總重', unit: 'kg' },
  { key: 'curb_weight_kg', label: '空車重', unit: 'kg' },
  { key: 'seats', label: '座位', unit: '人' },
  { key: 'displacement_cc', label: '排氣量', unit: 'c.c.' },
];

export function fieldConflict(variant, key) {
  return (variant?.field_conflicts || []).find((row) => row.field === key) || null;
}

/** 只有可追溯到此版本、沒有爭議的數值，才可計算差異。 */
export function comparableTruckValue(variant, key) {
  if (!variant || variant.status === 'pending' || variant.status === 'model_max_only') return null;
  if (fieldConflict(variant, key)) return null;
  const value = variant[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function truckMetricDisplay(variant, metric) {
  const conflict = fieldConflict(variant, metric.key);
  if (conflict) return conflict.display || '原廠資料不一致，待確認';
  const value = variant?.[metric.key];
  if (variant?.status === 'model_max_only' && metric.key === 'payload_kg' && Number.isFinite(value)) {
    return `車系最高 ${value.toLocaleString('zh-TW')} ${metric.unit}（未對應本版本）`;
  }
  if (value == null || value === '') return '待確認';
  if (typeof value === 'number') return `${value.toLocaleString('zh-TW', { maximumFractionDigits: 1 })} ${metric.unit}`;
  return String(value);
}

export function truckMetricDifference(left, right, metric) {
  const leftValue = comparableTruckValue(left, metric.key);
  const rightValue = comparableTruckValue(right, metric.key);
  if (leftValue == null || rightValue == null) return null;
  return leftValue - rightValue;
}

export function isConfirmedUnder3500(variant) {
  return variant?.body === 'open_bed'
    && Number.isFinite(variant.gross_vehicle_weight_kg)
    && variant.gross_vehicle_weight_kg < 3500
    && !['pending', 'model_max_only'].includes(variant.status);
}

export function buildTruckComparisonSummary(competitor, k2500) {
  if (!competitor || !k2500) return '';
  const keys = [
    { key: 'payload_kg', label: '合法載重', unit: 'kg' },
    { key: 'bed_length_mm', label: '貨斗長度', unit: 'mm' },
    { key: 'vehicle_height_mm', label: '整車車高', unit: 'mm' },
  ];
  const parts = [];
  for (const metric of keys) {
    const diff = truckMetricDifference(k2500, competitor, metric);
    if (diff == null || diff === 0) continue;
    parts.push(`K2500 的${metric.label}${diff > 0 ? '多' : '少'} ${Math.abs(diff).toLocaleString('zh-TW')} ${metric.unit}`);
    if (parts.length === 2) break;
  }
  if (parts.length === 0) return '部分規格仍待確認，先依已核實資料說明，不把缺值當成 0。';
  return `${parts.join('、')}；數字大小不等於一定較適合，仍要依貨物、限高與主要路線判斷。`;
}


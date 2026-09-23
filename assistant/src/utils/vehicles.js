const COMMON_POWERTRAIN = {
  engine: '6期環保・直列式4缸 DOHC 16汽門水冷柴油引擎',
  fuelSystem: 'CRDi 共軌式高壓直噴・渦輪增壓・中間冷卻器',
  displacementCc: 2497,
  compressionRatio: '15.8：1',
  maxPower: '130 ps / 3,600 rpm',
  maxTorque: '26.0 kg-m / 1,250～3,500 rpm',
  fuelTankL: 65,
  battery: '12V-100AH',
  alternator: '12V-90A',
  widthMm: 1740,
  cargoWidthMm: 1630,
};

const twoWheel = {
  ...COMMON_POWERTRAIN,
  drive: '2WD',
  driveLabel: '後輪驅動',
  lengthMm: 5125,
  heightMm: 1995,
  wheelbaseMm: 2615,
  cargoFloorHeightMm: 770,
  turningRadiusM: 5.02,
};

const fourWheel = {
  ...COMMON_POWERTRAIN,
  drive: '4WD',
  driveLabel: '2H / 4H / 4L 分時四輪傳動',
  heightMm: 2105,
  wheelbaseMm: 2415,
  cargoFloorHeightMm: 855,
  turningRadiusM: 5.64,
  differentialLock: '機械式後軸差速器鎖定',
};

/** Kia K2500 一般販售車型唯一資料來源。 */
export const VEHICLE_VARIANTS = [
  { ...twoWheel, id: 'qm-1', cab: '單廂', seats: 3, transmission: '手排', transmissionLabel: '6速手排', cargoLengthMm: 3110, curbWeightKg: 1757, payloadKg: 1483, grossVehicleWeightKg: 3240, fuelEconomyKmL: 10.8, annualFuelL: 1389, energyEfficiency: 4, topSpeedKmh: 142, msrpTwd: 818000, commissionTwd: 35000 },
  { ...twoWheel, id: 'qm-2', cab: '單廂', seats: 3, transmission: '自排', transmissionLabel: '5速手自排', cargoLengthMm: 3110, curbWeightKg: 1785, payloadKg: 1455, grossVehicleWeightKg: 3240, fuelEconomyKmL: 9.5, annualFuelL: 1579, energyEfficiency: 5, topSpeedKmh: 150, msrpTwd: 858000, commissionTwd: 35000 },
  { ...twoWheel, id: 'qm-3', cab: '大單廂', seats: 3, transmission: '手排', transmissionLabel: '6速手排', cargoLengthMm: 2860, curbWeightKg: 1778, payloadKg: 1462, grossVehicleWeightKg: 3240, fuelEconomyKmL: 10.6, annualFuelL: 1415, energyEfficiency: 4, topSpeedKmh: 142, msrpTwd: 848000, commissionTwd: 35000 },
  { ...twoWheel, id: 'qm-4', cab: '大單廂', seats: 3, transmission: '自排', transmissionLabel: '5速手自排', cargoLengthMm: 2860, curbWeightKg: 1799, payloadKg: 1441, grossVehicleWeightKg: 3240, fuelEconomyKmL: 9.2, annualFuelL: 1630, energyEfficiency: 5, topSpeedKmh: 150, msrpTwd: 888000, commissionTwd: 35000 },
  { ...twoWheel, id: 'qm-5', cab: '雙廂', seats: 6, transmission: '手排', transmissionLabel: '6速手排', cargoLengthMm: 2185, curbWeightKg: 1871, payloadKg: 1489, grossVehicleWeightKg: 3360, fuelEconomyKmL: 10.4, annualFuelL: 1442, energyEfficiency: 4, topSpeedKmh: 142, msrpTwd: 988000, commissionTwd: 50000 },
  { ...twoWheel, id: 'qm-6', cab: '雙廂', seats: 6, transmission: '自排', transmissionLabel: '5速手自排', cargoLengthMm: 2185, curbWeightKg: 1899, payloadKg: 1461, grossVehicleWeightKg: 3360, fuelEconomyKmL: 9.3, annualFuelL: 1613, energyEfficiency: 5, topSpeedKmh: 150, msrpTwd: 1038000, commissionTwd: 50000 },
  { ...fourWheel, id: 'qm-7', cab: '單廂', seats: 3, transmission: '手排', transmissionLabel: '6速手排', lengthMm: 4825, cargoLengthMm: 2810, curbWeightKg: 1864, payloadKg: 1376, grossVehicleWeightKg: 3240, fuelEconomyKmL: 9.4, annualFuelL: 1596, energyEfficiency: 5, topSpeedKmh: 142, msrpTwd: 978000, commissionTwd: 45000 },
  { ...fourWheel, id: 'qm-8', cab: '雙廂', seats: 6, transmission: '手排', transmissionLabel: '6速手排', lengthMm: 4810, cargoLengthMm: 1870, curbWeightKg: 1969, payloadKg: 1391, grossVehicleWeightKg: 3360, fuelEconomyKmL: 9.3, annualFuelL: 1613, energyEfficiency: 5, topSpeedKmh: 142, msrpTwd: 1078000, commissionTwd: 45000 },
].map((variant) => ({
  ...variant,
  name: `${variant.drive} ${variant.cab} ${variant.transmission}`,
  quoteName: `${variant.drive === '4WD' ? '4WD四輪傳動 ' : ''}${variant.cab}${variant.seats}人座 ${variant.transmissionLabel}`,
}));

export function convertMmToTaiwaneseChi(mm) {
  const value = Number(mm);
  return Number.isFinite(value) ? (value / 303.03).toFixed(2) : null;
}

export function formatVehiclePrice(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '待確認';
  const wan = value / 10000;
  return `${Number.isInteger(wan) ? wan : wan.toFixed(1)} 萬`;
}

export function formatTwd(amount) {
  const value = Number(amount);
  return Number.isFinite(value) ? `NT$${value.toLocaleString('zh-TW')}` : '待確認';
}

export function quoteVehicleModels() {
  return VEHICLE_VARIANTS.map((variant) => ({
    id: variant.id,
    name: variant.quoteName,
    price: variant.msrpTwd,
    msrpTwd: variant.msrpTwd,
    commissionTwd: variant.commissionTwd,
  }));
}

export function getVehicleVariant(id) {
  return VEHICLE_VARIANTS.find((variant) => variant.id === id) || null;
}

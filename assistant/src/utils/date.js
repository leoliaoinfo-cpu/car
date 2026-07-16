import dayjs from 'dayjs';
import 'dayjs/locale/zh-tw';

dayjs.locale('zh-tw');

export function today() {
  return dayjs().format('YYYY-MM-DD');
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return dayjs(dateStr).format('MM/DD');
}

export function formatDateFull(dateStr) {
  if (!dateStr) return '—';
  return dayjs(dateStr).format('YYYY/MM/DD');
}

export function addDays(dateStr, n) {
  return dayjs(dateStr).add(n, 'day').format('YYYY-MM-DD');
}

export function diffDays(dateStr) {
  return dayjs().diff(dayjs(dateStr), 'day');
}

export function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseMonthKey(key) {
  const [y, m] = key.split('-');
  return { year: Number(y), month: Number(m) };
}

export function getLast30Days() {
  const days = [];
  for (let i = 29; i >= 0; i--) {
    days.push(dayjs().subtract(i, 'day').format('YYYY-MM-DD'));
  }
  return days;
}

export function getMonthsInYear(year) {
  return Array.from({ length: 12 }, (_, i) => monthKey(year, i + 1));
}

export const QUICK_DATES = [
  { label: '明天', days: 1 },
  { label: '3天後', days: 3 },
  { label: '1週', days: 7 },
  { label: '2週', days: 14 },
  { label: '1個月', days: 30 },
  { label: '3個月', days: 90 },
];

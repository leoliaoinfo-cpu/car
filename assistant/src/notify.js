/** 系統通知工具：優先走 Service Worker（Android 必須、桌面也通用），
 *  沒有 SW 時退回傳統 Notification（桌面瀏覽器）。內容只含數量不含客戶資料。 */

export function notifySupported() {
  return typeof Notification !== 'undefined';
}

export function notifyPermission() {
  return notifySupported() ? Notification.permission : 'unsupported';
}

export async function requestNotifyPermission() {
  if (!notifySupported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

export async function showSystemNotification(body) {
  if (notifyPermission() !== 'granted') return false;
  const options = { body, tag: 'assistant-timer', icon: 'icon-192.png', badge: 'icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification('汽車銷售業務系統', options); return true; }
  } catch { /* 退回傳統通知 */ }
  try { new Notification('汽車銷售業務系統', options); return true; } catch { return false; }
}

/** Android 安裝 PWA 後可背景定時檢查到期提醒（其他平台自動略過） */
export async function registerPeriodicReminderCheck() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg || !('periodicSync' in reg)) return false;
    const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (perm.state !== 'granted') return false;
    await reg.periodicSync.register('check-reminders', { minInterval: 60 * 60 * 1000 });
    return true;
  } catch { return false; }
}

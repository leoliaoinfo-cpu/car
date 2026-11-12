import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context';
import { showSystemNotification, notifyPermission, registerPeriodicReminderCheck } from '../notify';
import dayjs from 'dayjs';

export default function TimerModal() {
  const { timers, saveTimer } = useApp();
  const [expiredTimer, setExpiredTimer] = useState(null);
  const intervalRef = useRef(null);
  const notifiedIdsRef = useRef(new Set());

  // Check for expired timers every 15 seconds
  useEffect(() => {
    function check() {
      const now = dayjs();
      const allExpired = timers.filter(
        (t) => !t.confirmedAt && dayjs(t.triggerAt).isBefore(now)
      );
      if (allExpired.length > 0 && !expiredTimer) setExpiredTimer(allExpired[0]);

      // 系統通知：只顯示數量，不含客戶資料（隱私考量），每筆只通知一次
      const fresh = allExpired.filter((t) => !notifiedIdsRef.current.has(t.id));
      if (fresh.length > 0) {
        showSystemNotification(`您有 ${allExpired.length} 則提醒到期`);
        fresh.forEach((t) => notifiedIdsRef.current.add(t.id));
      }
    }
    check();
    intervalRef.current = setInterval(check, 15000);
    return () => clearInterval(intervalRef.current);
  }, [timers, expiredTimer]);

  // Android 安裝 PWA 後註冊背景定時檢查（其他平台為 no-op）
  useEffect(() => {
    if (notifyPermission() === 'granted') registerPeriodicReminderCheck();
  }, []);

  const confirmTimer = useCallback(async () => {
    if (!expiredTimer) return;
    const updated = { ...expiredTimer, confirmedAt: new Date().toISOString() };
    await saveTimer(updated);
    setExpiredTimer(null);
  }, [expiredTimer, saveTimer]);

  // 目前所有到期未確認的提醒（多筆時可一次全部確認，免得逐一點）
  const expiredList = timers.filter((t) => !t.confirmedAt && dayjs(t.triggerAt).isBefore(dayjs()));

  const confirmAllExpired = useCallback(async () => {
    const now = new Date().toISOString();
    const toConfirm = timers.filter((t) => !t.confirmedAt && dayjs(t.triggerAt).isBefore(dayjs()));
    for (const t of toConfirm) await saveTimer({ ...t, confirmedAt: now });
    setExpiredTimer(null);
  }, [timers, saveTimer]);

  return (
    <>
      {/* Forced confirm modal for expired timer */}
      {expiredTimer && (
        <div className="modal">
          <div className="overlay" />
          <div className="relative anim-scale-in bg-s1 rounded-2xl p-6 shadow-panel max-w-sm w-full z-50 border border-bdr">
            <div className="text-4xl text-center mb-3">⏰</div>
            <h2 className="text-center font-bold text-lg text-ink mb-1">計時提醒</h2>
            {expiredList.length > 1 && (
              <p className="text-center text-xs text-accent mb-2">共 {expiredList.length} 則到期</p>
            )}
            <p className="text-center text-ink-2 text-sm mb-4">{expiredTimer.note || expiredTimer.clientName}</p>
            <p className="text-center text-ink-3 text-xs mb-5">
              設定時間：{dayjs(expiredTimer.triggerAt).format('MM/DD HH:mm')}
            </p>
            <button className="btn-primary w-full" onClick={confirmTimer}>
              確認已知道{expiredList.length > 1 ? '（下一則）' : ''}
            </button>
            {expiredList.length > 1 && (
              <button className="btn-outline w-full mt-2 text-sm" onClick={confirmAllExpired}>
                全部確認（{expiredList.length} 則）
              </button>
            )}
          </div>
        </div>
      )}

    </>
  );
}

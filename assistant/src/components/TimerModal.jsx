import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context';
import { generateId } from '../utils/crm';
import dayjs from 'dayjs';

export default function TimerModal() {
  const { timers, saveTimer, deleteTimer } = useApp();
  const [expiredTimer, setExpiredTimer] = useState(null);
  const [showList, setShowList] = useState(false);
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

      // 瀏覽器通知：只顯示數量，不含客戶資料（隱私考量），每筆只通知一次
      const fresh = allExpired.filter((t) => !notifiedIdsRef.current.has(t.id));
      if (fresh.length > 0 && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('汽車銷售業務系統', {
            body: `您有 ${allExpired.length} 則提醒到期`,
            tag: 'assistant-timer',
          });
        } catch { /* 部分行動瀏覽器需安裝 PWA 才支援通知 */ }
        fresh.forEach((t) => notifiedIdsRef.current.add(t.id));
      }
    }
    check();
    intervalRef.current = setInterval(check, 15000);
    return () => clearInterval(intervalRef.current);
  }, [timers, expiredTimer]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const confirmTimer = useCallback(async () => {
    if (!expiredTimer) return;
    const updated = { ...expiredTimer, confirmedAt: new Date().toISOString() };
    await saveTimer(updated);
    setExpiredTimer(null);
  }, [expiredTimer, saveTimer]);

  const pendingTimers = timers.filter((t) => !t.confirmedAt);

  return (
    <>
      {/* Floating timer button if there are pending timers */}
      {pendingTimers.length > 0 && !expiredTimer && (
        <button
          onClick={() => setShowList(true)}
          className="fixed bottom-24 right-4 md:bottom-6 bg-accent text-on-accent rounded-full px-3 py-2 text-sm font-medium shadow-panel z-40 flex items-center gap-1.5"
        >
          ⏱ {pendingTimers.length}
        </button>
      )}

      {/* Forced confirm modal for expired timer */}
      {expiredTimer && (
        <div className="modal">
          <div className="overlay" />
          <div className="relative anim-scale-in bg-s1 rounded-2xl p-6 shadow-panel max-w-sm w-full z-50 border border-bdr">
            <div className="text-4xl text-center mb-3">⏰</div>
            <h2 className="text-center font-bold text-lg text-ink mb-1">計時提醒</h2>
            <p className="text-center text-ink-2 text-sm mb-4">{expiredTimer.note || expiredTimer.clientName}</p>
            <p className="text-center text-ink-3 text-xs mb-5">
              設定時間：{dayjs(expiredTimer.triggerAt).format('MM/DD HH:mm')}
            </p>
            <button className="btn-primary w-full" onClick={confirmTimer}>
              確認已知道
            </button>
          </div>
        </div>
      )}

      {/* Timer list panel */}
      {showList && (
        <>
          <div className="overlay" onClick={() => setShowList(false)} />
          <div className="fixed bottom-0 left-0 right-0 md:right-auto md:left-auto md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:right-6 md:w-80 bg-s1 rounded-t-2xl md:rounded-2xl border border-bdr shadow-panel z-50 p-4 anim-slide-up md:anim-scale-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-ink">計時提醒列表</h3>
              <button onClick={() => setShowList(false)} className="text-ink-3 hover:text-ink text-lg">✕</button>
            </div>
            <AddTimerForm onAdd={async (t) => { await saveTimer(t); }} />
            <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
              {pendingTimers.length === 0 && (
                <p className="text-center text-ink-3 text-sm py-4">暫無計時提醒</p>
              )}
              {pendingTimers.map((t) => (
                <div key={t.id} className="flex items-center justify-between bg-s2 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-ink">{t.note || t.clientName}</p>
                    <p className="text-xs text-ink-3">{dayjs(t.triggerAt).format('MM/DD HH:mm')}</p>
                  </div>
                  <button onClick={() => deleteTimer(t.id)} className="text-danger text-sm hover:opacity-70">刪除</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function AddTimerForm({ onAdd }) {
  const [note, setNote] = useState('');
  const [time, setTime] = useState('');

  function handleAdd() {
    if (!note.trim() || !time) return;
    onAdd({
      id: generateId('timer'),
      note: note.trim(),
      triggerAt: new Date(time).toISOString(),
      confirmedAt: null,
      clientName: '',
    });
    setNote('');
    setTime('');
  }

  const minDate = dayjs().format('YYYY-MM-DDTHH:mm');

  return (
    <div className="flex gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="提醒內容"
        className="flex-1 text-sm"
      />
      <input
        type="datetime-local"
        value={time}
        min={minDate}
        onChange={(e) => setTime(e.target.value)}
        className="text-sm w-36"
      />
      <button onClick={handleAdd} className="btn-primary text-xs px-2">加入</button>
    </div>
  );
}

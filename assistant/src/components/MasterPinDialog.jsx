import { useState } from 'react';
import { checkMasterPin } from '../masterPinStore';
import { MASTER_MAX, MASTER_MAX_FAILS, MASTER_COOLDOWN_MS } from '../utils/masterPin';

/** 輸入統一密碼才能繼續的小視窗（修改／刪除成交報價等危險操作用）。 */
export default function MasterPinDialog({ title = '輸入密碼', description = '', confirmLabel = '確認', danger = false, onVerified, onCancel }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  async function submit() {
    if (busy || !pin) return;
    if (Date.now() < lockedUntil) { setError('輸入錯誤太多次，請稍等一下再試'); return; }
    setBusy(true); setError('');
    try {
      if (await checkMasterPin(pin)) { await onVerified(); return; }
      const n = fails + 1;
      setPin('');
      if (n >= MASTER_MAX_FAILS) { setFails(0); setLockedUntil(Date.now() + MASTER_COOLDOWN_MS); setError('錯太多次，請等 30 秒再試'); }
      else { setFails(n); setError('密碼不對'); }
    } catch (cause) {
      setError(cause?.message || '操作失敗，請再試一次');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-3 md:items-center" onClick={onCancel}>
      <form className="w-full max-w-sm rounded-2xl border border-bdr bg-s1 p-5 shadow-panel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h2 className="text-lg font-bold text-ink">🔒 {title}</h2>
        {description && <p className="mt-1 text-xs leading-relaxed text-ink-3">{description}</p>}
        <input type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={MASTER_MAX} value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }} aria-label="密碼"
          className="mt-3 min-h-12 w-full text-center text-2xl tracking-[0.5em]" />
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCancel} className="btn-outline min-h-12">取消</button>
          <button type="submit" disabled={!pin || busy} className={`${danger ? 'btn-danger' : 'btn-primary'} min-h-12 disabled:opacity-40`}>{busy ? '處理中…' : confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}

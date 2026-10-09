import { useEffect, useState } from 'react';
import DealsPage from './DealsPage';
import { STORAGE_KEYS } from '../../storageKeys';
import {
  DEFAULT_PRESENTATION_PIN_HASH, isValidPresentationPin, MAX_PRESENTATION_PIN_LENGTH,
  registerPinFailure, verifyPresentationPin,
} from '../../utils/presentationLock';

function readBackendPasswordHash() {
  try { return localStorage.getItem(STORAGE_KEYS.presentationPinHash) || DEFAULT_PRESENTATION_PIN_HASH; }
  catch { return DEFAULT_PRESENTATION_PIN_HASH; }
}

export default function OperationsPage({ onOpenClient, onBack, focusDealId = null }) {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [failureCount, setFailureCount] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const remainingSeconds = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  useEffect(() => {
    if (!remainingSeconds) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [remainingSeconds]);

  async function unlock() {
    if (busy || remainingSeconds || !isValidPresentationPin(password)) return;
    setBusy(true);
    setError('');
    try {
      if (await verifyPresentationPin(password, readBackendPasswordHash())) {
        setFailureCount(0);
        setLockedUntil(0);
        setNow(Date.now());
        setUnlocked(true);
      } else {
        const next = registerPinFailure(failureCount);
        setFailureCount(next.failureCount);
        setLockedUntil(next.lockedUntil);
        setNow(Date.now());
        setError(next.lockedUntil ? '嘗試次數過多，請稍後再試' : '密碼錯誤');
      }
    } catch {
      setError('暫時無法驗證，請重新整理後再試');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  if (unlocked) return <DealsPage onOpenClient={onOpenClient} focusDealId={focusDealId} />;

  return (
    <div className="max-w-md mx-auto px-4 py-8 sm:py-14">
      <button type="button" onClick={onBack} className="btn-ghost mb-4 text-sm lg:hidden">← 返回</button>
      <div className="card p-5 space-y-4 border-2 border-accent/25">
        <h1 className="text-xl font-bold text-ink">🗂️ 成交與施工管理</h1>
        <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={MAX_PRESENTATION_PIN_LENGTH} value={password}
          onChange={(event) => setPassword(event.target.value.replace(/\D/g, '').slice(0, MAX_PRESENTATION_PIN_LENGTH))}
          onKeyDown={(event) => { if (event.key === 'Enter') unlock(); }}
          placeholder="請輸入密碼" autoComplete="off" className="w-full" autoFocus />
        {error && <p className="text-xs text-danger">{error}</p>}
        {remainingSeconds > 0 && <p className="text-xs font-semibold text-warn">{remainingSeconds} 秒後可再次嘗試</p>}
        <button type="button" onClick={unlock} disabled={busy || remainingSeconds > 0 || !isValidPresentationPin(password)} className="btn-primary min-h-11 w-full disabled:opacity-40">{busy ? '驗證中…' : '進入管理頁'}</button>
      </div>
    </div>
  );
}

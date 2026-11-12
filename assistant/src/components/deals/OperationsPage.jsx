import { useEffect, useState } from 'react';
import DealsPage from './DealsPage';
import { STORAGE_KEYS } from '../../storageKeys';
import {
  createBackendSessionDeadline, DEFAULT_PRESENTATION_PIN_HASH, isBackendSessionUnlocked,
  isValidPresentationPin, MAX_PRESENTATION_PIN_LENGTH, readStoredPinHash, registerPinFailure, storePin, validateNewPin, verifyPresentationPin,
} from '../../utils/presentationLock';

function readBackendPasswordHash() {
  try { return localStorage.getItem(STORAGE_KEYS.presentationPinHash) || DEFAULT_PRESENTATION_PIN_HASH; }
  catch { return DEFAULT_PRESENTATION_PIN_HASH; }
}

function readUnlockUntil() {
  try { return Number(sessionStorage.getItem(STORAGE_KEYS.operationsUnlockUntil)) || 0; }
  catch { return 0; }
}

function saveUnlockUntil(value) {
  try { sessionStorage.setItem(STORAGE_KEYS.operationsUnlockUntil, String(value)); }
  catch { /* sessionStorage unavailable: keep only the current mounted page unlocked */ }
}

function clearUnlockSession() {
  try { sessionStorage.removeItem(STORAGE_KEYS.operationsUnlockUntil); }
  catch { /* sessionStorage unavailable: local state still locks the current page */ }
}

export default function OperationsPage({ onOpenClient, onBack, focusDealId = null, initialSection = null }) {
  const initialUnlockUntil = readUnlockUntil();
  const [unlockUntil, setUnlockUntil] = useState(initialUnlockUntil);
  const [unlocked, setUnlocked] = useState(() => isBackendSessionUnlocked(initialUnlockUntil));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [failureCount, setFailureCount] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [hasPin, setHasPin] = useState(() => Boolean(readStoredPinHash()));
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const remainingSeconds = Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const sessionRemainingSeconds = unlocked ? Math.max(0, Math.ceil((unlockUntil - now) / 1000)) : 0;

  useEffect(() => {
    if (!remainingSeconds) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [remainingSeconds]);

  useEffect(() => {
    if (!unlocked) return undefined;
    const remaining = Math.max(0, unlockUntil - Date.now());
    if (!remaining) {
      setUnlocked(false);
      return undefined;
    }
    const timer = setTimeout(() => setUnlocked(false), remaining);
    return () => clearTimeout(timer);
  }, [unlocked, unlockUntil]);

  useEffect(() => {
    if (!unlocked) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [unlocked]);

  function lockNow() {
    clearUnlockSession();
    setUnlockUntil(0);
    setUnlocked(false);
    setPassword('');
    setError('');
  }

  async function createPin() {
    if (busy) return;
    const problem = validateNewPin(newPin, newPin2);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      await storePin(newPin);
      setHasPin(true);
      const deadline = createBackendSessionDeadline();
      saveUnlockUntil(deadline);
      setUnlockUntil(deadline);
      setNow(Date.now());
      setUnlocked(true);
      setError('');
    } catch {
      setError('無法儲存密碼，請重新整理後再試');
    } finally {
      setNewPin(''); setNewPin2('');
      setBusy(false);
    }
  }

  async function unlock() {
    if (busy || remainingSeconds || !isValidPresentationPin(password)) return;
    setBusy(true);
    setError('');
    try {
      if (await verifyPresentationPin(password, readBackendPasswordHash())) {
        const deadline = createBackendSessionDeadline();
        saveUnlockUntil(deadline);
        setUnlockUntil(deadline);
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

  if (unlocked) return <DealsPage onOpenClient={onOpenClient} onBack={onBack} focusDealId={focusDealId} initialSection={initialSection} sessionRemainingSeconds={sessionRemainingSeconds} onLock={lockNow} />;

  if (!hasPin) {
    const digits = (value) => value.replace(/\D/g, '').slice(0, MAX_PRESENTATION_PIN_LENGTH);
    return (
      <div className="max-w-md mx-auto px-4 py-8 sm:py-14">
        <button type="button" onClick={onBack} className="btn-ghost mb-4 min-h-11 text-sm">← 返回</button>
        <div className="card p-5 space-y-4 border-2 border-accent/25">
          <h1 className="text-xl font-bold text-ink">🔐 先設定數字密碼</h1>
          <p className="text-sm text-ink-2">業績、成本與利潤要用密碼保護。請設定 4～12 位數字，記在自己腦袋裡；這支手機以後進來都用它。</p>
          <input type="password" inputMode="numeric" pattern="[0-9]*" value={newPin} onChange={(event) => setNewPin(digits(event.target.value))} placeholder="輸入新密碼" autoComplete="off" className="w-full" autoFocus />
          <input type="password" inputMode="numeric" pattern="[0-9]*" value={newPin2} onChange={(event) => setNewPin2(digits(event.target.value))} onKeyDown={(event) => { if (event.key === 'Enter') createPin(); }} placeholder="再輸入一次" autoComplete="off" className="w-full" />
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <button type="button" onClick={createPin} disabled={busy} className="btn-primary min-h-11 w-full disabled:opacity-40">{busy ? '儲存中…' : '設定並進入'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-8 sm:py-14">
      <button type="button" onClick={onBack} className="btn-ghost mb-4 min-h-11 text-sm">← 返回</button>
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

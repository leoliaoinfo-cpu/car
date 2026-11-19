import { useState } from 'react';
import { STORAGE_KEYS } from '../storageKeys';
import {
  createBackendSessionDeadline, isBackendSessionUnlocked, MAX_PRESENTATION_PIN_LENGTH, registerPinFailure,
} from '../utils/presentationLock';
import { checkMasterPin } from '../masterPinStore';

// 需要數字密碼才能看／改的區塊（報價選單的車型售價與配件價格等）。
// 與「業績與成本」共用同一組密碼與 30 分鐘的解鎖時間，解鎖一次兩邊都通。
function readUnlockUntil() {
  try { return Number(sessionStorage.getItem(STORAGE_KEYS.operationsUnlockUntil)) || 0; } catch { return 0; }
}
function saveUnlockUntil(value) {
  try { sessionStorage.setItem(STORAGE_KEYS.operationsUnlockUntil, String(value)); } catch { /* 只影響本次畫面 */ }
}

export default function PinGate({ title = '需要密碼', children }) {
  const [unlocked, setUnlocked] = useState(() => isBackendSessionUnlocked(readUnlockUntil()));
  const hasPin = true; // 全系統共用一組統一密碼（設定→密碼），不再各自設定
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const digits = (value) => value.replace(/\D/g, '').slice(0, MAX_PRESENTATION_PIN_LENGTH);

  if (unlocked) return children;

  function open() {
    saveUnlockUntil(createBackendSessionDeadline());
    setUnlocked(true);
  }

  async function submit() {
    if (busy) return;
    if (Date.now() < lockedUntil) { setError('嘗試次數過多，請稍後再試'); return; }
    setBusy(true);
    setError('');
    try {
      if (await checkMasterPin(pin)) {
        open();
      } else {
        const next = registerPinFailure(failures);
        setFailures(next.failureCount);
        setLockedUntil(next.lockedUntil);
        setError(next.lockedUntil ? '嘗試次數過多，請稍後再試' : '密碼錯誤');
      }
    } catch {
      setError('暫時無法驗證，請重新整理後再試');
    } finally {
      setPin('');
      setPin2('');
      setBusy(false);
    }
  }

  return (
    <div className="card mx-auto max-w-md space-y-4 border-2 border-accent/25 p-5">
      <h2 className="text-lg font-bold text-ink">🔐 {title}</h2>
      <p className="text-sm text-ink-2">這裡會影響報價的價格，請輸入密碼。</p>
      <input type="password" inputMode="numeric" pattern="[0-9]*" value={pin} onChange={(event) => setPin(digits(event.target.value))}
        onKeyDown={(event) => { if (event.key === 'Enter' && hasPin) submit(); }} placeholder={hasPin ? '請輸入密碼' : '輸入新密碼'} autoComplete="off" className="w-full" />
      {!hasPin && <input type="password" inputMode="numeric" pattern="[0-9]*" value={pin2} onChange={(event) => setPin2(digits(event.target.value))}
        onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} placeholder="再輸入一次" autoComplete="off" className="w-full" />}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <button type="button" onClick={submit} disabled={busy} className="btn-primary min-h-11 w-full disabled:opacity-40">{busy ? '驗證中…' : hasPin ? '解鎖' : '設定並解鎖'}</button>
    </div>
  );
}

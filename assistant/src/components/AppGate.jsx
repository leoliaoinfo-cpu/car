import { useState } from 'react';
import { STORAGE_KEYS } from '../storageKeys';
import {
  isGateUnlocked, GATE_REMEMBER_MS, GATE_MAX_TRIES, GATE_COOLDOWN_MS,
} from '../utils/appGate';
import { checkMasterPin } from '../masterPinStore';

function readUnlocked() {
  try { return isGateUnlocked(localStorage.getItem(STORAGE_KEYS.gateUnlockUntil)); } catch { return false; }
}

/** 進系統前先輸入密碼。沒通過時完全不載入系統（不讀資料庫、不同步）。 */
export default function AppGate({ children }) {
  const [ok, setOk] = useState(readUnlocked);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  if (ok) return children;

  const submit = async (e) => {
    e.preventDefault();
    if (Date.now() < lockedUntil) { setErr('輸入錯誤太多次，請稍後再試'); return; }
    if (await checkMasterPin(pin)) {
      try { localStorage.setItem(STORAGE_KEYS.gateUnlockUntil, String(Date.now() + GATE_REMEMBER_MS)); } catch { /* 無痕模式：這次有效 */ }
      setOk(true);
      return;
    }
    const n = fails + 1;
    setPin('');
    if (n >= GATE_MAX_TRIES) { setFails(0); setLockedUntil(Date.now() + GATE_COOLDOWN_MS); setErr('錯太多次，請等 30 秒再試'); }
    else { setFails(n); setErr('密碼不對'); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <form onSubmit={submit} className="w-full max-w-xs text-center">
        <div className="text-4xl mb-3">🔒</div>
        <h1 className="text-lg font-bold text-ink mb-1">請輸入密碼</h1>
        <p className="text-xs text-ink-3 mb-4">輸入後，這支手機 1 天內不用再輸入</p>
        <input
          type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={12}
          value={pin} onChange={(e) => { setPin(e.target.value); setErr(''); }}
          className="w-full text-center text-2xl tracking-[0.5em] rounded-xl border border-bdr bg-s1 text-ink py-3 mb-3"
          aria-label="密碼"
        />
        {err && <p className="text-sm text-red-500 mb-2">{err}</p>}
        <button type="submit" disabled={!pin} className="w-full rounded-xl bg-accent text-white font-bold py-3 disabled:opacity-40">進入</button>
      </form>
    </div>
  );
}

import { useState } from 'react';
import DealsPage from './DealsPage';

export default function OperationsPage({ onOpenClient, onBack, focusDealId = null }) {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function unlock() {
    if (password.trim() === '0623') {
      setPassword('');
      setError('');
      setUnlocked(true);
      return;
    }
    setError('密碼錯誤');
  }

  if (unlocked) return <DealsPage onOpenClient={onOpenClient} focusDealId={focusDealId} />;

  return (
    <div className="max-w-md mx-auto px-4 py-8 sm:py-14">
      <button type="button" onClick={onBack} className="btn-ghost mb-4 text-sm lg:hidden">← 返回</button>
      <div className="card p-5 space-y-4 border-2 border-accent/25">
        <h1 className="text-xl font-bold text-ink">🗂️ 成交與施工管理</h1>
        <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={password}
          onChange={(event) => setPassword(event.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(event) => { if (event.key === 'Enter') unlock(); }}
          placeholder="請輸入密碼" autoComplete="off" className="w-full" autoFocus />
        {error && <p className="text-xs text-danger">{error}</p>}
        <button type="button" onClick={unlock} disabled={!password.trim()} className="btn-primary w-full disabled:opacity-40">進入管理頁</button>
      </div>
    </div>
  );
}

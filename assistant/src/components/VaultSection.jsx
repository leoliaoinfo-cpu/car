import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { passphraseProblem } from '../utils/vault.js';
import {
  getDek, getLocalVaultRecord, setupVault, unlockThisDevice, changePassphrase, forgetDek, subscribeVault,
} from '../vaultSession';
import { fetchRemoteVaultRecord, isSyncEnabled, syncNow } from '../sync';

/** 🔒 成本加密保險箱：設定／解鎖／換密語。成本、利潤、傭金、薪資在雲端與備份檔一律加密。 */
export default function VaultSection() {
  const { costCatalog, saveCostCatalog } = useApp();
  const [state, setState] = useState({ loading: true, hasVault: false, unlocked: false, remoteRecord: null });
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [p3, setP3] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [showChange, setShowChange] = useState(false);

  async function refresh() {
    const local = await getLocalVaultRecord();
    let remoteRecord = null;
    if (!local) { try { remoteRecord = await fetchRemoteVaultRecord(); } catch { remoteRecord = null; } }
    const dek = await getDek();
    setState({ loading: false, hasVault: !!(local || remoteRecord), unlocked: !!dek && !!(local || remoteRecord), remoteRecord });
  }
  useEffect(() => { refresh(); return subscribeVault(refresh); }, []);

  const reset = () => { setP1(''); setP2(''); setP3(''); setAck(false); };
  const run = async (fn) => {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); } catch (e) { setErr(e?.message || '操作失敗'); } finally { setBusy(false); }
  };

  const create = () => run(async () => {
    const problem = passphraseProblem(p1);
    if (problem) throw new Error(problem);
    if (p1 !== p2) throw new Error('兩次輸入的密語不一樣');
    if (!ack) throw new Error('請先勾選「我已把密語抄下來」');
    if (isSyncEnabled()) {
      const remote = await fetchRemoteVaultRecord().catch(() => null);
      if (remote) throw new Error('雲端已經設定過成本密語，請改用「解鎖這台裝置」');
    }
    await setupVault(p1);
    // 把目前的成本設定完整存一次（之後程式裡就不需要保留任何成本數字）
    await saveCostCatalog(costCatalog);
    reset();
    if (isSyncEnabled()) syncNow();
    setMsg('✅ 已啟用成本加密。雲端同步檔與備份檔裡的成本、利潤、傭金、薪資，從現在起都只會是加密後的亂碼。');
  });

  const unlock = () => run(async () => {
    await unlockThisDevice(p1, state.remoteRecord);
    reset();
    if (isSyncEnabled()) syncNow();
    setMsg('✅ 這台裝置已解鎖，可以正常同步與備份。');
  });

  const change = () => run(async () => {
    if (p2 !== p3) throw new Error('兩次輸入的新密語不一樣');
    await changePassphrase(p1, p2);
    reset(); setShowChange(false);
    if (isSyncEnabled()) syncNow();
    setMsg('✅ 成本密語已更換。其他裝置下次要用新密語解鎖。');
  });

  const lock = () => run(async () => { await forgetDek(); setMsg('🔒 這台裝置已上鎖，下次同步或備份前要重新輸入成本密語。'); });

  if (state.loading) return <div className="card max-w-xl p-4 text-sm text-ink-3">讀取中…</div>;

  const pwInput = (label, value, setter, auto = 'current-password') => (
    <label className="block text-xs font-medium text-ink-3">{label}
      <input type="password" value={value} onChange={(e) => setter(e.target.value)} autoComplete={auto}
        autoCapitalize="off" autoCorrect="off" spellCheck={false} className="mt-1 min-h-11 w-full" />
    </label>
  );

  return (
    <section className="card max-w-xl p-4 space-y-4">
      <div>
        <h2 className="font-bold text-ink">🔒 成本加密保險箱</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-3">
          成本、利潤、傭金、薪資在<b>雲端同步檔</b>和<b>備份檔</b>裡一律加密（AES-256）。沒有成本密語，就算拿到檔案也看不到數字。客戶資料不加密。
        </p>
      </div>

      {!state.hasVault && (
        <div className="space-y-3">
          <p className="rounded-xl border border-warn/50 bg-warn/10 p-3 text-xs leading-relaxed text-ink-2">
            ⚠️ 密語至少 8 個字、要有英文和數字（例如 <code>kia2500leo</code>）。<br />
            <b>忘記密語，加密的成本資料永遠救不回來</b>，連工程師也救不了。請抄在紙上收好。
          </p>
          {pwInput('設定成本密語', p1, setP1, 'new-password')}
          {pwInput('再輸入一次', p2, setP2, 'new-password')}
          <label className="flex items-start gap-2 text-xs text-ink-2 min-h-11">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
            我已把密語抄下來收好，了解忘記就無法復原。
          </label>
          <button type="button" disabled={busy} onClick={create} className="btn-primary min-h-11 w-full disabled:opacity-40">{busy ? '加密中…' : '啟用成本加密'}</button>
        </div>
      )}

      {state.hasVault && !state.unlocked && (
        <div className="space-y-3">
          <p className="rounded-xl border border-bdr bg-s2 p-3 text-xs text-ink-2">已啟用成本加密，這台裝置還沒解鎖。輸入成本密語一次，之後這台裝置就記住了。</p>
          {pwInput('成本密語', p1, setP1)}
          <button type="button" disabled={busy || !p1} onClick={unlock} className="btn-primary min-h-11 w-full disabled:opacity-40">{busy ? '解鎖中…' : '解鎖這台裝置'}</button>
        </div>
      )}

      {state.hasVault && state.unlocked && (
        <div className="space-y-3">
          <p className="rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm text-ok">✅ 已啟用，這台裝置已解鎖</p>
          {!showChange ? (
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => { reset(); setShowChange(true); }} className="btn-outline min-h-11 text-xs">更換成本密語</button>
              <button type="button" disabled={busy} onClick={lock} className="btn-outline min-h-11 text-xs">這台裝置上鎖</button>
            </div>
          ) : (
            <div className="space-y-3">
              {pwInput('目前的成本密語', p1, setP1)}
              {pwInput('新的成本密語', p2, setP2, 'new-password')}
              {pwInput('再輸入一次新密語', p3, setP3, 'new-password')}
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={change} className="btn-primary min-h-11 flex-1 disabled:opacity-40">{busy ? '更換中…' : '確認更換'}</button>
                <button type="button" onClick={() => setShowChange(false)} className="btn-outline min-h-11">取消</button>
              </div>
            </div>
          )}
        </div>
      )}

      {err && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{err}</p>}
      {msg && <p role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm text-ok">{msg}</p>}
    </section>
  );
}

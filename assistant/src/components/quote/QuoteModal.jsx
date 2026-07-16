import { useState, useEffect } from 'react';
import { db } from '../../db';
import { generateId, formatMoney, calcMonthlyPayment } from '../../utils/crm';
import { useApp } from '../../context';
import dayjs from 'dayjs';

/**
 * 報價單產生器：填車型與項目價格 → 產生美觀的報價單（固定淺色，方便截圖給客人）。
 * 新增模式（quote=null）會把總額寫入客戶時間軸；傳入既有 quote 則為編輯模式。
 */
export default function QuoteModal({ client, quote, onSaveQuote, onClose }) {
  const { quotePresets } = useApp();
  const isEdit = !!quote;
  const [model, setModel] = useState(quote?.model || '');
  const [items, setItems] = useState(() =>
    quote?.items?.length
      ? quote.items.map((it) => ({ ...it, price: String(it.price) }))
      : [{ id: generateId('qi'), name: '車輛售價', price: '' }]
  );
  const [note, setNote] = useState(quote?.note || '');
  const [profile, setProfile] = useState({ name: '', phone: '' });
  // 貸款試算 + 每月營收（生財工具心法：算出這台車每月幫頭家淨賺多少）
  const [loan, setLoan] = useState({
    down: quote?.loan?.down != null ? String(quote.loan.down) : '',
    months: quote?.loan?.months != null ? String(quote.loan.months) : '',
    rate: quote?.loan?.rate != null ? String(quote.loan.rate) : '',
    revenue: quote?.loan?.revenue != null ? String(quote.loan.revenue) : '',
  });

  // 業務署名記在本機，下次自動帶入
  useEffect(() => {
    db.get('settings', 'quoteProfile')
      .then((row) => { if (row) setProfile({ name: row.name || '', phone: row.phone || '' }); })
      .catch(() => {});
  }, []);

  function saveProfile(next) {
    setProfile(next);
    db.put('settings', { key: 'quoteProfile', ...next }).catch(() => {});
  }

  const total = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
  // 補助折抵為負數項目，一併列入
  const validItems = items.filter((it) => it.name.trim() && Number(it.price) !== 0);

  const loanPrincipal = Math.max(0, total - (Number(loan.down) || 0));
  const monthlyPay = calcMonthlyPayment(loanPrincipal, loan.rate, loan.months);
  const monthlyRevenue = Number(loan.revenue) || 0;
  const monthlyNet = monthlyRevenue - monthlyPay;

  function addPresetItem(name, price) {
    setItems((list) => {
      // 同名項目不重複加入
      if (list.some((it) => it.name.trim() === name)) return list;
      // 若第一列還是空白列，直接填入
      const emptyIdx = list.findIndex((it) => !it.name.trim() && !Number(it.price));
      if (emptyIdx !== -1) {
        return list.map((it, i) => (i === emptyIdx ? { ...it, name, price: String(price) } : it));
      }
      return [...list, { id: generateId('qi'), name, price: String(price) }];
    });
  }

  function setItem(id, patch) {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((list) => [...list, { id: generateId('qi'), name: '', price: '' }]);
  }

  function removeItem(id) {
    setItems((list) => (list.length > 1 ? list.filter((it) => it.id !== id) : list));
  }

  async function handleRecord() {
    await onSaveQuote({
      id: quote?.id || generateId('quote'),
      date: quote?.date || dayjs().format('YYYY-MM-DD'),
      model: model.trim(),
      items: validItems.map((it) => ({ id: it.id, name: it.name.trim(), price: Number(it.price) })),
      note: note.trim(),
      total,
      loan: {
        down: Number(loan.down) || 0,
        months: Number(loan.months) || 0,
        rate: Number(loan.rate) || 0,
        revenue: monthlyRevenue,
      },
      text: `報價單：${model.trim() || '未填車型'}｜${validItems.map((i) => i.name.trim()).join('、')}`,
    });
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
        <div className="bg-s1 rounded-2xl shadow-panel border border-bdr w-full max-w-md p-4 anim-scale-in my-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lg text-ink">🧾 {isEdit ? '編輯報價單' : '報價單產生器'}</h3>
            <button onClick={onClose} className="btn-ghost text-xl leading-none px-2 py-1">✕</button>
          </div>

          {/* 輸入區 */}
          <div className="space-y-2 mb-4">
            <input value={model} onChange={(e) => setModel(e.target.value)}
              placeholder="車型（例：KIA 卡旺 K2500 標準貨斗）" className="w-full text-sm" />

            {/* 車體配備快選（設定 → 報價選單 可自訂） */}
            {quotePresets.addons.length > 0 && (
              <div className="flex gap-1.5 flex-wrap items-center">
                <span className="text-[11px] text-ink-3 shrink-0">🚚 車體配備：</span>
                {quotePresets.addons.map((a) => (
                  <button key={a.id} type="button"
                    onClick={() => addPresetItem(a.name, Number(a.price) || 0)}
                    className="btn-outline text-[11px] px-2 py-0.5">
                    {a.name} {formatMoney(a.price)}
                  </button>
                ))}
              </div>
            )}
            {/* 補助折抵快選（負數帶入） */}
            {quotePresets.subsidies.length > 0 && (
              <div className="flex gap-1.5 flex-wrap items-center">
                <span className="text-[11px] text-ink-3 shrink-0">🏛 補助折抵：</span>
                {quotePresets.subsidies.map((s) => (
                  <button key={s.id} type="button"
                    onClick={() => addPresetItem(s.name, -(Math.abs(Number(s.amount) || 0)))}
                    className="btn-outline text-[11px] px-2 py-0.5 text-ok border-ok/40">
                    {s.name} -{formatMoney(Math.abs(s.amount))}
                  </button>
                ))}
              </div>
            )}
            {items.map((it) => (
              <div key={it.id} className="flex gap-2">
                <input value={it.name} onChange={(e) => setItem(it.id, { name: e.target.value })}
                  placeholder="項目（配備 / 保險 / 領牌…）" className="flex-1 text-sm min-w-0" />
                <input type="number" min="0" value={it.price}
                  onChange={(e) => setItem(it.id, { price: e.target.value })}
                  placeholder="金額" className="w-28 text-sm" />
                <button onClick={() => removeItem(it.id)}
                  className="text-danger/50 hover:text-danger shrink-0 px-1">✕</button>
              </div>
            ))}
            <button onClick={addItem} className="btn-outline text-xs">＋ 新增項目</button>

            {/* 貸款試算：月付金 vs 每月營收 */}
            <div className="bg-s2 rounded-lg p-2.5 space-y-1.5">
              <p className="text-[11px] font-medium text-ink-2">🏦 貸款試算（選填）</p>
              <div className="grid grid-cols-3 gap-1.5">
                <input type="number" min="0" value={loan.down}
                  onChange={(e) => setLoan((v) => ({ ...v, down: e.target.value }))}
                  placeholder="頭期款" className="text-xs min-w-0" />
                <input type="number" min="0" value={loan.months}
                  onChange={(e) => setLoan((v) => ({ ...v, months: e.target.value }))}
                  placeholder="期數(月)" className="text-xs min-w-0" />
                <input type="number" min="0" step="0.1" value={loan.rate}
                  onChange={(e) => setLoan((v) => ({ ...v, rate: e.target.value }))}
                  placeholder="年利率%" className="text-xs min-w-0" />
              </div>
              <input type="number" min="0" value={loan.revenue}
                onChange={(e) => setLoan((v) => ({ ...v, revenue: e.target.value }))}
                placeholder="這台車預估每月幫客戶賺多少（元）" className="w-full text-xs" />
              {monthlyPay > 0 && (
                <p className="text-[11px] text-ink-2">
                  月付 <strong className="text-accent">NT$ {formatMoney(monthlyPay)}</strong>
                  {monthlyRevenue > 0 && (
                    <>，每月淨賺 <strong className="text-ok">NT$ {formatMoney(monthlyNet)}</strong></>
                  )}
                </p>
              )}
            </div>

            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="備註（有效期限、交車條件…）" className="w-full text-sm" />
            <div className="flex gap-2">
              <input value={profile.name} onChange={(e) => saveProfile({ ...profile, name: e.target.value })}
                placeholder="業務姓名" className="flex-1 text-sm min-w-0" />
              <input value={profile.phone} onChange={(e) => saveProfile({ ...profile, phone: e.target.value })}
                placeholder="聯絡電話" className="flex-1 text-sm min-w-0" />
            </div>
          </div>

          {/* 報價單預覽 — 固定淺色，截圖給客人用 */}
          <div className="rounded-xl overflow-hidden shadow-panel mx-auto" style={{ maxWidth: 360, background: '#ffffff' }}>
            <div style={{ background: '#5f7f96', padding: '14px 20px' }}>
              <p style={{ color: '#ffffff', fontSize: 18, fontWeight: 700, letterSpacing: 6 }}>報 價 單</p>
              <p style={{ color: '#d7e2ea', fontSize: 11, marginTop: 2 }}>
                {dayjs(quote?.date || undefined).format('YYYY 年 M 月 D 日')}
              </p>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <p style={{ color: '#8fa0ac', fontSize: 11 }}>致</p>
              <p style={{ color: '#2e3a42', fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
                {client?.name || '貴賓'}
              </p>
              {model.trim() && (
                <div style={{ background: '#eef1f4', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                  <p style={{ color: '#5f7f96', fontSize: 13, fontWeight: 700 }}>🚛 {model}</p>
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {validItems.map((it) => {
                    const p = Number(it.price);
                    return (
                      <tr key={it.id} style={{ borderBottom: '1px solid #e3e9ed' }}>
                        <td style={{ color: p < 0 ? '#6f957a' : '#5a6b77', fontSize: 13, padding: '7px 0' }}>
                          {p < 0 ? `🏛 ${it.name}` : it.name}
                        </td>
                        <td style={{
                          color: p < 0 ? '#6f957a' : '#2e3a42', fontSize: 13, padding: '7px 0',
                          textAlign: 'right', fontWeight: p < 0 ? 700 : 500,
                        }}>
                          {p < 0 ? `-${formatMoney(Math.abs(p))}` : formatMoney(p)}
                        </td>
                      </tr>
                    );
                  })}
                  {validItems.length === 0 && (
                    <tr><td style={{ color: '#8fa0ac', fontSize: 12, padding: '10px 0', textAlign: 'center' }} colSpan={2}>
                      （尚未輸入項目）
                    </td></tr>
                  )}
                </tbody>
              </table>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                borderTop: '2px solid #5f7f96', marginTop: 8, paddingTop: 10,
              }}>
                <span style={{ color: '#5a6b77', fontSize: 13, fontWeight: 600 }}>總計</span>
                <span style={{ color: '#5f7f96', fontSize: 22, fontWeight: 800 }}>
                  NT$ {formatMoney(total)}
                </span>
              </div>
              {monthlyPay > 0 && (
                <div style={{ background: '#eef1f4', borderRadius: 8, padding: '10px 12px', marginTop: 12 }}>
                  <p style={{ color: '#5a6b77', fontSize: 11, marginBottom: 4 }}>
                    🏦 貸款試算：頭期 {formatMoney(Number(loan.down) || 0)}・
                    {loan.months} 期{Number(loan.rate) > 0 ? `・年利率 ${loan.rate}%` : ''}
                  </p>
                  <p style={{ color: '#2e3a42', fontSize: 14, fontWeight: 700 }}>
                    月付 NT$ {formatMoney(monthlyPay)}
                  </p>
                  {monthlyRevenue > 0 && (
                    <p style={{ color: '#6f957a', fontSize: 12, fontWeight: 600, marginTop: 4 }}>
                      💪 預估每月收益 {formatMoney(monthlyRevenue)} − 月付 ≈ 每月淨賺 NT$ {formatMoney(monthlyNet)}
                    </p>
                  )}
                </div>
              )}
              {note.trim() && (
                <p style={{ color: '#8fa0ac', fontSize: 11, marginTop: 10, whiteSpace: 'pre-wrap' }}>※ {note}</p>
              )}
              {(profile.name || profile.phone) && (
                <div style={{ borderTop: '1px solid #e3e9ed', marginTop: 12, paddingTop: 10, textAlign: 'right' }}>
                  <p style={{ color: '#5a6b77', fontSize: 12, fontWeight: 600 }}>{profile.name}</p>
                  {profile.phone && <p style={{ color: '#8fa0ac', fontSize: 11 }}>📞 {profile.phone}</p>}
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-xs text-ink-3 mt-3">📸 直接截圖上方報價單傳給客人</p>
          <div className="flex gap-2 mt-3">
            <button onClick={onClose} className="btn-outline flex-1">關閉</button>
            <button onClick={handleRecord} disabled={total <= 0}
              className="btn-primary flex-1 disabled:opacity-40">
              💲 {isEdit ? '儲存修改' : '記錄報價'}（NT$ {formatMoney(total)}）
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

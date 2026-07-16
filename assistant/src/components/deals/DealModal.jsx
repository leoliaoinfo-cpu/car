import { useState } from 'react';
import { generateId, FIELD_COLORS } from '../../utils/crm';
import { today } from '../../utils/date';

/**
 * 成交歸檔表單（新增 / 編輯共用）。
 * deal 為 null 時是新增模式，需給 client；編輯模式傳入既有 deal。
 */
export default function DealModal({ deal, client, dealFields, onSave, onClose }) {
  const isEdit = !!deal;
  const [date, setDate] = useState(deal?.date || today());
  const [note, setNote] = useState(deal?.note || '');
  const [amount, setAmount] = useState(
    deal?.amount != null ? String(deal.amount) : String(prefillAmount(client) || '')
  );
  const [fieldValues, setFieldValues] = useState(() => {
    const init = {};
    for (const f of dealFields) {
      const v = deal?.fields?.[f.id];
      init[f.id] = v != null ? String(v) : '';
    }
    return init;
  });

  function prefillAmount(c) {
    // 用最近一筆帶金額的事件（下訂/報價）當預設成交金額
    if (!c?.log) return null;
    return [...c.log].reverse().find((e) => e.amount > 0)?.amount ?? null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const fields = {};
    for (const f of dealFields) {
      const n = Number(fieldValues[f.id]);
      if (n > 0) fields[f.id] = n;
    }
    await onSave({
      id: deal?.id || generateId('deal'),
      clientId: deal?.clientId ?? client?.id ?? null,
      clientName: deal?.clientName ?? client?.name ?? '',
      date: date || today(),
      note: note.trim(),
      amount: Number(amount) > 0 ? Number(amount) : 0,
      fields,
      ...(deal?.createdAt ? { createdAt: deal.createdAt } : {}),
    });
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="bg-s1 rounded-2xl shadow-panel border border-bdr w-full max-w-sm p-5 anim-scale-in z-50">
          <h3 className="font-bold text-lg text-ink mb-1">
            🏆 {isEdit ? '編輯業績' : '成交歸檔'}
          </h3>
          <p className="text-xs text-ink-3 mb-4">
            {isEdit ? deal.clientName : client?.name}｜歸入 {date?.slice(0, 7).replace('-', ' 年 ')} 月業績
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <span className="w-20 shrink-0">成交日期</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1" required />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <span className="w-20 shrink-0">成交金額</span>
              <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0" className="flex-1" />
            </label>
            {dealFields.map((f) => (
              <label key={f.id} className="flex items-center gap-2 text-sm">
                <span className="w-20 shrink-0 font-medium" style={{ color: FIELD_COLORS[f.colorIdx % FIELD_COLORS.length] }}>
                  {f.name}
                </span>
                <input type="number" min="0" value={fieldValues[f.id]}
                  onChange={(e) => setFieldValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  placeholder="0" className="flex-1" />
              </label>
            ))}
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="車型 / 備註（選填）" className="w-full text-sm" />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-outline flex-1">取消</button>
              <button type="submit" className="btn-primary flex-1">{isEdit ? '儲存' : '歸檔'}</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

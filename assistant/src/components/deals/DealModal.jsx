import { useState } from 'react';
import { generateId, FIELD_COLORS } from '../../utils/crm';
import { today } from '../../utils/date';
import { Field } from '../ui';

/**
 * 成交案表單（新增 / 編輯共用）。
 * deal 為 null 時是新增模式，需給 client；編輯模式傳入既有 deal。
 */
export default function DealModal({ deal, client, cases = [], dealFields, onSave, onClose }) {
  const isEdit = !!deal;
  const availableCases = cases.filter((row) => !client?.id || row.clientId === client.id || row.id === deal?.caseId);
  const initialCaseId = deal?.caseId || (availableCases.filter((row) => row.status !== 'completed').length === 1
    ? availableCases.find((row) => row.status !== 'completed')?.id
    : '');
  const [date, setDate] = useState(deal?.date || today());
  const [note, setNote] = useState(deal?.note || '');
  const [amount, setAmount] = useState(
    deal?.amount != null ? String(deal.amount) : String(prefillAmount(client) || '')
  );
  const [caseId, setCaseId] = useState(initialCaseId);
  const [caseError, setCaseError] = useState('');
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
    const activeCases = availableCases.filter((row) => row.status !== 'completed');
    if (!isEdit && activeCases.length > 1 && !caseId) {
      setCaseError('這位客戶有多筆進行中案件，請先選擇本次成交屬於哪一筆。');
      return;
    }
    const fields = {};
    for (const f of dealFields) {
      const n = Number(fieldValues[f.id]);
      if (n > 0) fields[f.id] = n;
    }
    await onSave({
      ...(deal || {}),
      id: deal?.id || generateId('deal'),
      clientId: deal?.clientId ?? client?.id ?? null,
      clientName: deal?.clientName ?? client?.name ?? '',
      caseId: caseId || deal?.caseId || null,
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
            🏆 {isEdit ? '編輯成交案' : '建立成交案'}
          </h3>
          <p className="text-xs text-ink-3 mb-4">
            {isEdit ? deal.clientName : client?.name}｜歸入 {date?.slice(0, 7).replace('-', ' 年 ')} 月業績
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            {availableCases.length > 0 && (
              <label className="block text-sm text-ink-2">
                <span className="block mb-1.5 font-medium">歸入客戶案件</span>
                <select value={caseId} onChange={(event) => { setCaseId(event.target.value); setCaseError(''); }} className="w-full min-h-11">
                  <option value="">請選擇案件…</option>
                  {availableCases.map((row) => <option key={row.id} value={row.id}>{row.caseNumber != null ? `#${row.caseNumber}・` : ''}{row.type === 'modification' ? '改車' : '購車'}・{row.title || '未命名案件'}{row.status === 'completed' ? '（已完成）' : ''}</option>)}
                </select>
                {caseError && <span className="block mt-1 text-xs text-danger">{caseError}</span>}
              </label>
            )}
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
            <Field label="車型 / 備註（選填）">
              <input value={note} onChange={(e) => setNote(e.target.value)}
                className="w-full text-sm" />
            </Field>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-outline flex-1">取消</button>
              <button type="submit" className="btn-primary flex-1">{isEdit ? '儲存' : '建立成交案'}</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

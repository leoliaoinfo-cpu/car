import { useMemo, useState } from 'react';

const EMPTY_FORM = {
  name: '', servicesText: '', contact: '', phone: '', line: '', address: '', payment: '', warranty: '', note: '', active: true,
};

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `supplier-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function SupplierPanel({ suppliers, onSave, onDelete }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const shown = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return [...suppliers]
      .filter((supplier) => !keyword || [supplier.name, supplier.contact, supplier.phone, ...(supplier.services || [])]
        .some((value) => String(value || '').toLowerCase().includes(keyword)))
      .sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name, 'zh-Hant'));
  }, [search, suppliers]);

  function startCreate() {
    setEditing({ ...EMPTY_FORM, id: makeId() });
  }

  function startEdit(supplier) {
    setEditing({ ...EMPTY_FORM, ...supplier, servicesText: (supplier.services || []).join('、') });
  }

  async function submit(event) {
    event.preventDefault();
    if (!editing.name.trim()) return;
    await onSave({
      ...editing,
      name: editing.name.trim(),
      services: editing.servicesText.split(/[、,，/]/).map((value) => value.trim()).filter(Boolean),
    });
    setEditing(null);
  }

  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-ink">🤝 合作廠商名冊</h2>
            <p className="text-xs text-ink-3 mt-1">記住廠商聯絡方式、承作項目、付款與保固；施工流程可直接指派。</p>
          </div>
          <button type="button" onClick={startCreate} className="btn-primary text-xs shrink-0">＋ 新增廠商</button>
        </div>
        <input value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder="搜尋廠商、聯絡人、電話或承作項目" className="w-full text-sm" />
      </div>

      {editing && (
        <form onSubmit={submit} className="card border-2 border-accent/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-ink">{suppliers.some((row) => row.id === editing.id) ? '編輯廠商' : '新增廠商'}</h3>
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" checked={editing.active !== false}
                onChange={(event) => setEditing((current) => ({ ...current, active: event.target.checked }))} />啟用
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input required value={editing.name} onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))} placeholder="廠商名稱 *" />
            <input value={editing.servicesText} onChange={(event) => setEditing((current) => ({ ...current, servicesText: event.target.value }))} placeholder="承作項目：尾門、帆布、烤漆…" />
            <input value={editing.contact} onChange={(event) => setEditing((current) => ({ ...current, contact: event.target.value }))} placeholder="聯絡人" />
            <input value={editing.phone} onChange={(event) => setEditing((current) => ({ ...current, phone: event.target.value }))} placeholder="電話" />
            <input value={editing.line} onChange={(event) => setEditing((current) => ({ ...current, line: event.target.value }))} placeholder="LINE／其他聯絡方式" />
            <input value={editing.address} onChange={(event) => setEditing((current) => ({ ...current, address: event.target.value }))} placeholder="地址" />
            <input value={editing.payment} onChange={(event) => setEditing((current) => ({ ...current, payment: event.target.value }))} placeholder="付款方式／帳期" />
            <input value={editing.warranty} onChange={(event) => setEditing((current) => ({ ...current, warranty: event.target.value }))} placeholder="保固說明" />
          </div>
          <textarea rows={2} value={editing.note} onChange={(event) => setEditing((current) => ({ ...current, note: event.target.value }))} placeholder="合作注意事項、報價習慣或其他備註" className="w-full" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="btn-outline text-xs">取消</button>
            <button type="submit" className="btn-primary text-xs">儲存廠商</button>
          </div>
        </form>
      )}

      {shown.length === 0 && <p className="card p-6 text-center text-sm text-ink-3">尚未建立合作廠商。</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {shown.map((supplier) => (
          <article key={supplier.id} className={`card p-3 space-y-2 ${supplier.active === false ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-ink truncate">{supplier.name}</h3>
                <p className="text-[11px] text-ink-3">{supplier.active === false ? '已停用' : '合作中'}</p>
              </div>
              <button type="button" onClick={() => startEdit(supplier)} className="text-xs text-accent hover:underline">編輯</button>
            </div>
            {(supplier.services || []).length > 0 && (
              <div className="flex flex-wrap gap-1">{supplier.services.map((service) => <span key={service} className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">{service}</span>)}</div>
            )}
            <div className="text-xs leading-relaxed text-ink-2">
              {(supplier.contact || supplier.phone) && <p>{supplier.contact || '聯絡人未填'}{supplier.phone ? `・${supplier.phone}` : ''}</p>}
              {supplier.line && <p>LINE：{supplier.line}</p>}
              {supplier.address && <p>地址：{supplier.address}</p>}
              {supplier.payment && <p>付款：{supplier.payment}</p>}
              {supplier.warranty && <p>保固：{supplier.warranty}</p>}
              {supplier.note && <p className="mt-1 text-ink-3">{supplier.note}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-bdr pt-2">
              {confirmDeleteId === supplier.id ? (
                <>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className="btn-outline text-[10px]">取消</button>
                  <button type="button" onClick={async () => { await onDelete(supplier.id); setConfirmDeleteId(null); }} className="btn-danger text-[10px]">確認刪除</button>
                </>
              ) : <button type="button" onClick={() => setConfirmDeleteId(supplier.id)} className="text-[10px] text-danger/60 hover:text-danger">刪除廠商</button>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}


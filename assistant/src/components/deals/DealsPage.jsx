import { useState, useMemo } from 'react';
import { useApp } from '../../context';
import { sumDeals, formatMoney, FIELD_COLORS } from '../../utils/crm';
import DealModal from './DealModal';
import dayjs from 'dayjs';

export default function DealsPage({ onOpenClient }) {
  const { deals, dealFields, saveDeal, deleteDeal } = useApp();
  const [view, setView] = useState('month'); // 'month' | 'all'
  const [monthKey, setMonthKey] = useState(dayjs().format('YYYY-MM'));
  const [editingDeal, setEditingDeal] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const sortedFields = useMemo(
    () => [...dealFields].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [dealFields]
  );

  const monthDeals = useMemo(
    () => deals
      .filter((d) => (d.date || '').slice(0, 7) === monthKey)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [deals, monthKey]
  );

  const allDealsByMonth = useMemo(() => {
    const groups = {};
    for (const d of deals) {
      const key = (d.date || '').slice(0, 7) || '未知';
      (groups[key] = groups[key] || []).push(d);
    }
    return Object.entries(groups)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, list]) => ({
        key,
        list: list.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
        totals: sumDeals(list, sortedFields),
      }));
  }, [deals, sortedFields]);

  const shownDeals = view === 'month' ? monthDeals : deals;
  const totals = useMemo(() => sumDeals(shownDeals, sortedFields), [shownDeals, sortedFields]);

  function shiftMonth(n) {
    setMonthKey(dayjs(monthKey + '-01').add(n, 'month').format('YYYY-MM'));
  }

  async function handleDelete(id) {
    await deleteDeal(id);
    setDeleteConfirmId(null);
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      {/* 標題 + 檢視切換 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-ink">📈 業績表</h1>
        <div className="flex rounded-lg border border-bdr overflow-hidden">
          <button onClick={() => setView('month')}
            className={`px-3 py-1.5 text-sm font-medium ${view === 'month' ? 'bg-accent text-on-accent' : 'text-ink-2 hover:bg-s2'}`}>
            單月
          </button>
          <button onClick={() => setView('all')}
            className={`px-3 py-1.5 text-sm font-medium ${view === 'all' ? 'bg-accent text-on-accent' : 'text-ink-2 hover:bg-s2'}`}>
            總表
          </button>
        </div>
      </div>

      {/* 月份選擇（單月模式） */}
      {view === 'month' && (
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => shiftMonth(-1)} className="btn-ghost text-lg px-3">‹</button>
          <span className="font-semibold text-ink min-w-32 text-center">
            {dayjs(monthKey + '-01').format('YYYY 年 M 月')}
          </span>
          <button onClick={() => shiftMonth(1)} className="btn-ghost text-lg px-3">›</button>
        </div>
      )}

      {/* 加總卡 */}
      <div className="card p-4">
        <p className="text-xs text-ink-3 mb-2">
          {view === 'month' ? `${dayjs(monthKey + '-01').format('M 月')}成交` : '全部成交'}
          <strong className="text-ink ml-1">{totals.count} 件</strong>
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <p className="text-[11px] text-ink-3">成交金額</p>
            <p className="text-lg font-bold text-accent">NT$ {formatMoney(totals.amount)}</p>
          </div>
          {sortedFields.map((f) => (
            <div key={f.id}>
              <p className="text-[11px] text-ink-3">{f.name}</p>
              <p className="text-lg font-bold" style={{ color: FIELD_COLORS[f.colorIdx % FIELD_COLORS.length] }}>
                NT$ {formatMoney(totals.fields[f.id])}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 明細 */}
      {view === 'month' ? (
        <div className="card overflow-hidden">
          {monthDeals.length === 0 && (
            <p className="text-center text-ink-3 text-sm py-10">
              本月尚無成交紀錄。到客戶詳情按「🏆 成交歸檔」即可帶入。
            </p>
          )}
          {monthDeals.map((d) => (
            <DealRow key={d.id} deal={d} fields={sortedFields}
              onOpenClient={onOpenClient}
              onEdit={() => setEditingDeal(d)}
              confirming={deleteConfirmId === d.id}
              onDeleteAsk={() => setDeleteConfirmId(d.id)}
              onDeleteCancel={() => setDeleteConfirmId(null)}
              onDelete={() => handleDelete(d.id)} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {allDealsByMonth.length === 0 && (
            <div className="card p-10 text-center text-ink-3 text-sm">
              尚無任何成交紀錄。到客戶詳情按「🏆 成交歸檔」開始累積業績表。
            </div>
          )}
          {allDealsByMonth.map((g) => (
            <div key={g.key} className="card overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-bdr bg-s2/50">
                <button onClick={() => { setMonthKey(g.key); setView('month'); }}
                  className="font-semibold text-sm text-accent hover:underline">
                  {dayjs(g.key + '-01').format('YYYY 年 M 月')}
                </button>
                <span className="text-xs text-ink-2">
                  {g.totals.count} 件 · NT$ {formatMoney(g.totals.amount)}
                </span>
              </div>
              {g.list.map((d) => (
                <DealRow key={d.id} deal={d} fields={sortedFields}
                  onOpenClient={onOpenClient}
                  onEdit={() => setEditingDeal(d)}
                  confirming={deleteConfirmId === d.id}
                  onDeleteAsk={() => setDeleteConfirmId(d.id)}
                  onDeleteCancel={() => setDeleteConfirmId(null)}
                  onDelete={() => handleDelete(d.id)} />
              ))}
            </div>
          ))}
        </div>
      )}

      {editingDeal && (
        <DealModal
          deal={editingDeal}
          dealFields={sortedFields}
          onClose={() => setEditingDeal(null)}
          onSave={async (d) => { await saveDeal(d); setEditingDeal(null); }}
        />
      )}
    </div>
  );
}

function DealRow({ deal, fields, onOpenClient, onEdit, confirming, onDeleteAsk, onDeleteCancel, onDelete }) {
  return (
    <div className="px-3 py-2.5 border-b border-bdr/50 last:border-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-ink-3 font-mono shrink-0">{dayjs(deal.date).format('MM/DD')}</span>
        {deal.clientId ? (
          <button onClick={() => onOpenClient(deal.clientId)}
            className="font-medium text-sm text-accent hover:underline">
            {deal.clientName || '（未命名）'}
          </button>
        ) : (
          <span className="font-medium text-sm text-ink">{deal.clientName || '（未命名）'}</span>
        )}
        {deal.note && <span className="text-xs text-ink-3 truncate">{deal.note}</span>}
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          {confirming ? (
            <>
              <button onClick={onDelete} className="btn-danger text-xs px-2 py-0.5">確定刪除</button>
              <button onClick={onDeleteCancel} className="btn-outline text-xs px-2 py-0.5">取消</button>
            </>
          ) : (
            <>
              <button onClick={onEdit} className="text-ink-3 hover:text-ink text-xs">✏️</button>
              <button onClick={onDeleteAsk} className="text-danger/40 hover:text-danger text-xs">✕</button>
            </>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-1">
        <span className="text-xs font-semibold text-accent">NT$ {formatMoney(deal.amount)}</span>
        {fields.map((f) => {
          const v = deal.fields?.[f.id];
          if (!v) return null;
          return (
            <span key={f.id} className="text-[11px] px-1.5 py-0.5 rounded-full"
              style={{
                background: FIELD_COLORS[f.colorIdx % FIELD_COLORS.length] + '18',
                color: FIELD_COLORS[f.colorIdx % FIELD_COLORS.length],
              }}>
              {f.name} {formatMoney(v)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

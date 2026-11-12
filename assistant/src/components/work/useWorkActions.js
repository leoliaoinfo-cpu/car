import { useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { buildWorkQueue } from '../../utils/cases';
import { today } from '../../utils/date';
import { generateId } from '../../utils/crm';
import { normalizeDeliveryWorkflow } from '../../utils/delivery';

/** 每種工作在卡片上的那一顆主要按鈕。 */
export function primaryLabel(row) {
  switch (row.sourceType) {
    case 'stock-alert': return '核對配件';
    case 'delivery': return '處理進度';
    case 'case-follow-up':
    case 'case-stale': return '記錄聯繫';
    case 'client-follow': return '已聯繫';
    case 'client-delivery': return '處理交車';
    case 'timer': return '知道了';
    case 'occasion': return '已問候';
    case 'event': return '看行事曆';
    default: return '完成';
  }
}

export const canSnooze = (row) => !['stock-alert', 'delivery', 'event', 'occasion'].includes(row.sourceType);
export const canCancel = (row) => ['case-follow-up', 'client-follow', 'delivery', 'workItem', 'task', 'client-todo', 'timer'].includes(row.sourceType);

/**
 * 工作頁與行事曆共用：同一份工作佇列＋同一套「完成／延後／取消／開啟」。
 * 所有寫入都走 context。
 */
export function useWorkActions({ onOpenClient, onOpenCase, onOpenOperations, onOpenCalendar } = {}) {
  const {
    workItems, tasks, clients, deals, cases, timers, events, customFields,
    saveWorkItem, saveTask, updateClient, saveActivity, saveCase, saveDeal, saveTimer, deleteTimer,
  } = useApp();
  const queue = useMemo(
    () => buildWorkQueue({ workItems, tasks, clients, deals, cases, timers, events, customFields }),
    [workItems, tasks, clients, deals, cases, timers, events, customFields],
  );
  const [busyId, setBusyId] = useState(null);
  const busy = useRef(false);

  async function writeActivity(row, text) {
    if (!row.caseId && !row.clientId) return;
    await saveActivity({
      id: generateId('activity'), caseId: row.caseId || null, clientId: row.clientId || null,
      type: 'work', text, date: today(),
    });
  }

  function openRow(row) {
    if (row.sourceType === 'delivery') onOpenOperations?.(row.dealId, row.caseId);
    else if (row.sourceType === 'event' && onOpenCalendar) onOpenCalendar(row);
    else if (['client-follow', 'client-delivery', 'occasion'].includes(row.sourceType) && row.clientId) onOpenClient?.(row.clientId);
    else if (row.caseId && onOpenCase) onOpenCase(row.caseId);
    else if (row.clientId) onOpenClient?.(row.clientId);
  }

  async function guarded(row, job) {
    if (busy.current) return;
    busy.current = true;
    setBusyId(row.id);
    try {
      await job();
    } catch (err) {
      console.error(err);
      window.alert(err?.message || '儲存失敗，請再試一次。');
    } finally {
      busy.current = false;
      setBusyId(null);
    }
  }

  /** 卡片的主要按鈕：能直接完成的就完成，需要多填資料的就帶去該處理的地方。 */
  function complete(row) {
    if (['stock-alert', 'delivery', 'case-follow-up', 'case-stale', 'client-delivery', 'event'].includes(row.sourceType)) {
      openRow(row);
      return Promise.resolve();
    }
    return guarded(row, async () => {
      const now = new Date().toISOString();
      if (row.sourceType === 'workItem') {
        const current = workItems.find((item) => item.id === row.sourceId);
        if (current) await saveWorkItem({ ...current, state: 'done', completedAt: now });
      } else if (row.sourceType === 'task') {
        const current = tasks.find((item) => item.id === row.sourceId);
        if (current) await saveTask({ ...current, done: true, doneAt: now });
      } else if (row.sourceType === 'client-todo') {
        await updateClient(row.clientId, (client) => ({
          ...client, todos: (client.todos || []).map((item) => item.id === row.sourceId ? { ...item, done: true, doneAt: now } : item),
        }));
      } else if (row.sourceType === 'client-follow') {
        await updateClient(row.clientId, (client) => ({
          ...client, lastContact: today(), missedCalls: 0, nextDate: null,
          log: [...(client.log || []), { id: generateId('log'), date: today(), text: '已聯繫', type: 'contact' }],
        }));
        return;
      } else if (row.sourceType === 'occasion') {
        // 紀念日問候：記一筆聯繫，但不動原本排好的追蹤日。
        await updateClient(row.clientId, (client) => ({
          ...client, lastContact: today(), missedCalls: 0,
          log: [...(client.log || []), { id: generateId('log'), date: today(), text: `${row.title}問候`, type: 'contact' }],
        }));
        return;
      } else if (row.sourceType === 'timer') {
        const current = timers.find((item) => item.id === row.sourceId);
        if (current) await saveTimer({ ...current, confirmedAt: now });
        return;
      }
      await writeActivity(row, `完成：${row.title}`);
    });
  }

  /** 延後到指定日期（YYYY-MM-DD）。 */
  function snoozeTo(row, due) {
    if (!due || !canSnooze(row)) return Promise.resolve();
    return guarded(row, async () => {
      if (row.sourceType === 'case-follow-up' || row.sourceType === 'case-stale') {
        const current = cases.find((item) => item.id === row.caseId);
        if (current) await saveCase({ ...current, nextFollowUpDate: due, updatedAt: new Date().toISOString() });
      } else if (row.sourceType === 'workItem') {
        const current = workItems.find((item) => item.id === row.sourceId);
        if (current) await saveWorkItem({ ...current, due, state: 'todo' });
      } else if (row.sourceType === 'task') {
        const current = tasks.find((item) => item.id === row.sourceId);
        if (current) await saveTask({ ...current, due });
      } else if (row.sourceType === 'client-todo') {
        await updateClient(row.clientId, (client) => ({ ...client, todos: (client.todos || []).map((item) => item.id === row.sourceId ? { ...item, due } : item) }));
      } else if (row.sourceType === 'client-follow') {
        await updateClient(row.clientId, (client) => ({ ...client, nextDate: due }));
      } else if (row.sourceType === 'client-delivery') {
        await updateClient(row.clientId, (client) => ({ ...client, deliveryDate: due }));
      } else if (row.sourceType === 'timer') {
        const current = timers.find((item) => item.id === row.sourceId);
        if (current) {
          const old = dayjs(current.triggerAt);
          await saveTimer({ ...current, triggerAt: dayjs(due).hour(old.hour()).minute(old.minute()).second(0).toISOString() });
        }
      }
    });
  }

  function cancel(row) {
    if (!canCancel(row)) return Promise.resolve();
    return guarded(row, async () => {
      const canceledAt = new Date().toISOString();
      if (row.sourceType === 'case-follow-up') {
        const current = cases.find((item) => item.id === row.caseId);
        if (current) await saveCase({ ...current, nextFollowUpDate: '', updatedAt: canceledAt });
      } else if (row.sourceType === 'client-follow') {
        await updateClient(row.clientId, (client) => ({ ...client, nextDate: null }));
        return;
      } else if (row.sourceType === 'timer') {
        await deleteTimer(row.sourceId);
        return;
      } else if (row.sourceType === 'delivery') {
        const deal = deals.find((item) => item.id === row.dealId);
        if (deal) {
          const deliveryWorkflow = normalizeDeliveryWorkflow(deal).map((step) => step.id === row.sourceId
            ? { ...step, status: 'na', completedAt: canceledAt, statusChangedAt: canceledAt }
            : step);
          await saveDeal({ ...deal, deliveryWorkflow });
        }
      } else if (row.sourceType === 'workItem') {
        const current = workItems.find((item) => item.id === row.sourceId);
        if (current) await saveWorkItem({ ...current, state: 'cancelled', canceledAt });
      } else if (row.sourceType === 'task') {
        const current = tasks.find((item) => item.id === row.sourceId);
        if (current) await saveTask({ ...current, done: true, canceled: true, doneAt: canceledAt, canceledAt });
      } else if (row.sourceType === 'client-todo') {
        await updateClient(row.clientId, (client) => ({
          ...client,
          todos: (client.todos || []).map((item) => item.id === row.sourceId ? { ...item, done: true, canceled: true, doneAt: canceledAt, canceledAt } : item),
        }));
      }
      await writeActivity(row, `取消：${row.title}`);
    });
  }

  return { queue, busyId, complete, snoozeTo, cancel, openRow };
}

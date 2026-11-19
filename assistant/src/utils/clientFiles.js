// 客戶／案件的照片與檔案：誰看得到、檔案圖示、大小上限。純邏輯，有測試。
export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 單檔上限 20MB（只存本機，太大會佔滿手機）
export const FILE_ACCEPT = 'application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,image/*';

/**
 * 這筆資料在目前畫面看不看得到：
 *  • 客戶頁（沒有 caseId）：這個客戶全部都看得到
 *  • 案件詳情：只看這個案件的＋「客戶共用」（沒有案件的）；名片不放在案件裡；別的案件的不顯示（各案件各自存放）
 */
export function photoScope(row, caseId = null) {
  if (!caseId) return 'client';
  if (row.kind === 'card') return 'hidden';
  if (row.caseId === caseId) return 'case';
  if (!row.caseId) return 'shared';
  return 'hidden';
}

export function fileIcon(name = '', mime = '') {
  const ext = String(name).toLowerCase().split('.').pop();
  if (mime === 'application/pdf' || ext === 'pdf') return '📕';
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
  if (['ppt', 'pptx'].includes(ext)) return '📙';
  if (ext === 'zip') return '🗜️';
  if (String(mime).startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp'].includes(ext)) return '🖼️';
  return '📄';
}

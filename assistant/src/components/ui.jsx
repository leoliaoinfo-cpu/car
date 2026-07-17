/** 表單欄位：標題固定顯示在輸入框上方，打字後欄位名稱不會消失 */
export function Field({ label, required, className = '', children }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="block text-[11px] font-medium text-ink-3 mb-1">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  );
}

import { useState, useEffect, useRef } from 'react';
import { db } from '../../db';
import { useApp } from '../../context';
import { compressImage, formatBytes } from '../../utils/image';
import { generateId } from '../../utils/crm';
import { ConfirmDeleteButton } from '../ui';
import { fileIcon, MAX_FILE_BYTES, FILE_ACCEPT, photoScope } from '../../utils/clientFiles';

/**
 * 客戶／案件的照片、名片、檔案（PDF、合約…）：全都只存本機 IndexedDB（Blob，不上雲端、不進備份），
 * 照片上傳時自動壓縮；檔案存原檔。刪除客戶時一併刪除。
 *
 * 客戶頁與案件詳情「相通」：
 *  • 在案件裡加的 → 記在那個案件（每個案件各自存放），客戶頁看得到，並標註是哪個案件。
 *  • 在客戶頁加的 → 算「客戶共用」，該客戶的每個案件都看得到。
 */
export default function ClientPhotos({ clientId, caseId = null }) {
  const { cases = [] } = useApp();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [viewer, setViewer] = useState(null);
  const urlsRef = useRef(new Map());
  const cardInput = useRef(null);
  const photoInput = useRef(null);
  const fileInput = useRef(null);

  const caseName = (id) => {
    const row = cases.find((item) => item.id === id);
    return row ? `${row.type === 'modification' ? '改裝' : '買車'}・${row.title || '未命名案件'}` : '已刪除的案件';
  };
  const urlFor = (p) => {
    if (!urlsRef.current.has(p.id)) urlsRef.current.set(p.id, URL.createObjectURL(p.blob));
    return urlsRef.current.get(p.id);
  };

  useEffect(() => {
    let alive = true;
    const urls = urlsRef.current;
    db.getPhotos(clientId)
      .then((list) => { if (alive) setRows(list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))); })
      .catch(() => {});
    return () => {
      alive = false;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [clientId]);

  // 這個畫面看得到哪些：案件裡＝這個案件的＋客戶共用的（沒有名片）；客戶頁＝這個客戶全部
  const visible = rows.filter((row) => photoScope(row, caseId) !== 'hidden');
  const cards = caseId ? [] : visible.filter((p) => p.kind === 'card');
  const pics = visible.filter((p) => p.kind === 'photo');
  const files = visible.filter((p) => p.kind === 'file');
  const totalSize = visible.reduce((s, p) => s + (p.size || 0), 0);

  const tag = (p) => (p.caseId ? (caseId ? null : `案件：${caseName(p.caseId)}`) : (caseId ? '客戶共用' : null));

  async function handleImages(kind, fileList) {
    const list = [...(fileList || [])].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setBusy(true); setMessage('');
    try {
      const added = [];
      let usedOriginal = false;
      for (const file of list) {
        let blob = file, w = 0, h = 0;
        try {
          const r = await compressImage(file, kind === 'card' ? { maxDim: 1800, quality: 0.78 } : { maxDim: 1600, quality: 0.72 });
          blob = r.blob; w = r.w; h = r.h;
        } catch { usedOriginal = true; }
        const photo = { id: generateId('photo'), clientId, caseId: caseId || null, kind, blob, size: blob.size, w, h, name: file.name || '', createdAt: new Date().toISOString() };
        await db.putPhoto(photo);
        added.push(photo);
      }
      setRows((prev) => [...prev, ...added]);
      setMessage(usedOriginal ? `已儲存 ${added.length} 張；其中有照片無法壓縮，會占用較多本機空間。` : `已儲存 ${added.length} 張照片。`);
    } catch (error) { setMessage(saveError(error, '照片')); }
    finally { setBusy(false); }
  }

  async function handleFiles(fileList) {
    const list = [...(fileList || [])];
    if (!list.length) return;
    setBusy(true); setMessage('');
    try {
      const added = [];
      const tooBig = [];
      for (const file of list) {
        if (file.size > MAX_FILE_BYTES) { tooBig.push(file.name); continue; }
        const row = { id: generateId('file'), clientId, caseId: caseId || null, kind: 'file', blob: file, size: file.size, mime: file.type || '', name: file.name || '檔案', createdAt: new Date().toISOString() };
        await db.putPhoto(row);
        added.push(row);
      }
      setRows((prev) => [...prev, ...added]);
      const parts = [];
      if (added.length) parts.push(`已儲存 ${added.length} 個檔案。`);
      if (tooBig.length) parts.push(`❌「${tooBig.join('、')}」超過 ${formatBytes(MAX_FILE_BYTES)}，沒有存入（太大會佔滿手機空間）。`);
      setMessage(parts.join(' '));
    } catch (error) { setMessage(saveError(error, '檔案')); }
    finally { setBusy(false); }
  }

  async function remove(id) {
    await db.deletePhoto(id);
    const url = urlsRef.current.get(id);
    if (url) { URL.revokeObjectURL(url); urlsRef.current.delete(id); }
    setRows((prev) => prev.filter((p) => p.id !== id));
    setViewer((v) => (v === id ? null : v));
  }

  function openFile(row) {
    const url = URL.createObjectURL(row.blob);
    const viewable = /^(application\/pdf|image\/)/.test(row.mime || row.blob.type || '');
    const download = () => { const a = document.createElement('a'); a.href = url; a.download = row.name; a.click(); };
    if (viewable) { const win = window.open(url, '_blank'); if (!win) download(); } else download();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const grid = (list) => (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {list.map((p) => (
        <div key={p.id} className="relative group rounded-lg overflow-hidden bg-s3 border border-bdr" style={{ aspectRatio: '1 / 1' }}>
          <img src={urlFor(p)} alt="" loading="lazy" className="w-full h-full object-cover cursor-pointer" onClick={() => setViewer(p.id)} />
          {tag(p) && <span className="absolute bottom-0 inset-x-0 truncate bg-black/55 px-1 py-0.5 text-[9px] text-white">{tag(p)}</span>}
          <button onClick={() => remove(p.id)} aria-label="刪除照片"
            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white text-xs flex items-center justify-center md:opacity-0 md:group-hover:opacity-100 transition-opacity">✕</button>
        </div>
      ))}
    </div>
  );

  const viewerPhoto = viewer ? rows.find((p) => p.id === viewer) : null;

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-ink-2">{caseId ? '📷 案件照片與檔案' : '📷 照片 / 名片 / 檔案'}</h3>
        <span className="text-[11px] text-ink-3">{pics.length + cards.length} 張・{files.length} 個檔案・{formatBytes(totalSize)}</span>
      </div>

      {!caseId && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-ink-2">💳 名片（{cards.length}）</span>
            <button onClick={() => cardInput.current?.click()} disabled={busy} className="btn-outline text-xs disabled:opacity-40">＋ 加名片</button>
            <input ref={cardInput} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { handleImages('card', e.target.files); e.target.value = ''; }} />
          </div>
          {cards.length > 0 ? grid(cards) : <p className="text-[11px] text-ink-3">尚無名片，點「加名片」拍照或從相簿選。</p>}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-2">🖼 照片（{pics.length}）</span>
          <button onClick={() => photoInput.current?.click()} disabled={busy} className="btn-outline text-xs disabled:opacity-40">＋ 加照片</button>
          <input ref={photoInput} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { handleImages('photo', e.target.files); e.target.value = ''; }} />
        </div>
        {pics.length > 0 ? grid(pics) : <p className="text-[11px] text-ink-3">{caseId ? '尚無照片，可存車況、施工過程、交車現場等。' : '尚無照片，可存車輛、證件、交車現場等。'}</p>}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-2">📄 檔案（{files.length}）<span className="font-normal text-ink-3"> PDF、合約、Word、Excel…</span></span>
          <button onClick={() => fileInput.current?.click()} disabled={busy} className="btn-outline text-xs disabled:opacity-40">＋ 加檔案</button>
          <input ref={fileInput} type="file" accept={FILE_ACCEPT} multiple className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
        </div>
        {files.length > 0 ? (
          <ul className="space-y-1.5">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border border-bdr bg-s2 p-2">
                <button type="button" onClick={() => openFile(f)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="text-xl shrink-0">{fileIcon(f.name, f.mime)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{f.name}</span>
                    <span className="block text-[11px] text-ink-3">{formatBytes(f.size || 0)}・{(f.createdAt || '').slice(0, 10)}{tag(f) ? `・${tag(f)}` : ''}</span>
                  </span>
                </button>
                <ConfirmDeleteButton onConfirm={() => remove(f.id)} ariaLabel={`刪除 ${f.name}`} className="shrink-0 px-2 text-danger/60 hover:text-danger" />
              </li>
            ))}
          </ul>
        ) : <p className="text-[11px] text-ink-3">尚無檔案。點「加檔案」選 PDF、合約等（每個最大 {formatBytes(MAX_FILE_BYTES)}）。</p>}
      </div>

      {busy && <p className="text-xs text-accent">處理中…</p>}
      {message && <p className="text-xs text-ink-2 bg-s2 rounded-lg px-3 py-2">{message}</p>}
      <p className="text-[10px] text-ink-3 leading-relaxed">
        {caseId
          ? '這裡只放這個案件的照片與檔案，另外也會顯示在客戶頁；在客戶頁加的「客戶共用」資料，這個客戶的每個案件都看得到。'
          : '在案件裡加的照片與檔案也會顯示在這裡（標註是哪個案件）；在這裡加的算「客戶共用」，這個客戶的每個案件都看得到。'}
        {' '}所有照片與檔案只存在這台裝置（不上傳雲端、不進備份），換手機或清除瀏覽器資料會不見，重要合約請另外備份。刪除客戶會一併刪除。
      </p>

      {viewerPhoto && (
        <div className="safe-panel fixed inset-0 z-[60] bg-black flex items-center justify-center anim-fade-in" onClick={() => setViewer(null)}>
          <img src={urlFor(viewerPhoto)} alt="" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setViewer(null)} className="absolute top-3 right-4 text-white/90 text-3xl leading-none">✕</button>
          <button onClick={(e) => { e.stopPropagation(); remove(viewerPhoto.id); }}
            className="absolute bottom-5 left-1/2 -translate-x-1/2 btn-danger text-sm">🗑 刪除這張</button>
        </div>
      )}
    </section>
  );
}

function saveError(error, what) {
  return error?.name === 'QuotaExceededError'
    ? `❌ 本機儲存空間不足，${what}沒有全部存入。請先刪除不需要的照片或檔案。`
    : `❌ ${what}儲存失敗：${error?.message || '請稍後再試'}`;
}

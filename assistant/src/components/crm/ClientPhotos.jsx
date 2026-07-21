import { useState, useEffect, useRef } from 'react';
import { db } from '../../db';
import { compressImage, formatBytes } from '../../utils/image';
import { generateId } from '../../utils/crm';

/**
 * 客戶照片 / 名片：上傳時自動壓縮，存進本機 IndexedDB（Blob，不上雲端同步、不進備份），
 * 刪除客戶時會一併刪除。顯示用 objectURL 並在卸載/刪除時釋放，避免記憶體洩漏。
 */
export default function ClientPhotos({ clientId }) {
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState(null); // 放大檢視的 photo id
  const urlsRef = useRef(new Map());
  const cardInput = useRef(null);
  const photoInput = useRef(null);

  const urlFor = (p) => {
    if (!urlsRef.current.has(p.id)) urlsRef.current.set(p.id, URL.createObjectURL(p.blob));
    return urlsRef.current.get(p.id);
  };

  useEffect(() => {
    let alive = true;
    const urls = urlsRef.current;
    db.getPhotos(clientId)
      .then((list) => { if (alive) setPhotos(list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))); })
      .catch(() => {});
    return () => {
      alive = false;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [clientId]);

  async function handleFiles(kind, fileList) {
    const files = [...(fileList || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    setBusy(true);
    try {
      const added = [];
      for (const file of files) {
        let blob = file, w = 0, h = 0;
        try {
          const r = await compressImage(file, kind === 'card' ? { maxDim: 1800, quality: 0.78 } : { maxDim: 1600, quality: 0.72 });
          blob = r.blob; w = r.w; h = r.h;
        } catch { /* 壓縮失敗就存原檔 */ }
        const photo = { id: generateId('photo'), clientId, kind, blob, size: blob.size, w, h, name: file.name || '', createdAt: new Date().toISOString() };
        await db.putPhoto(photo);
        added.push(photo);
      }
      setPhotos((prev) => [...prev, ...added]);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    await db.deletePhoto(id);
    const url = urlsRef.current.get(id);
    if (url) { URL.revokeObjectURL(url); urlsRef.current.delete(id); }
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    setViewer((v) => (v === id ? null : v));
  }

  const cards = photos.filter((p) => p.kind === 'card');
  const pics = photos.filter((p) => p.kind === 'photo');
  const totalSize = photos.reduce((s, p) => s + (p.size || 0), 0);

  const grid = (list) => (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {list.map((p) => (
        <div key={p.id} className="relative group rounded-lg overflow-hidden bg-s3 border border-bdr" style={{ aspectRatio: '1 / 1' }}>
          <img src={urlFor(p)} alt="" loading="lazy" className="w-full h-full object-cover cursor-pointer" onClick={() => setViewer(p.id)} />
          <button onClick={() => remove(p.id)}
            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white text-xs flex items-center justify-center md:opacity-0 md:group-hover:opacity-100 transition-opacity">✕</button>
        </div>
      ))}
    </div>
  );

  const viewerPhoto = viewer ? photos.find((p) => p.id === viewer) : null;

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-ink-2">📷 照片 / 名片</h3>
        <span className="text-[11px] text-ink-3">{photos.length} 張 · {formatBytes(totalSize)}</span>
      </div>

      {/* 名片 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-2">💳 名片（{cards.length}）</span>
          <button onClick={() => cardInput.current?.click()} disabled={busy} className="btn-outline text-xs disabled:opacity-40">＋ 加名片</button>
          <input ref={cardInput} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { handleFiles('card', e.target.files); e.target.value = ''; }} />
        </div>
        {cards.length > 0 ? grid(cards) : <p className="text-[11px] text-ink-3">尚無名片，點「加名片」拍照或從相簿選。</p>}
      </div>

      {/* 照片 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-2">🖼 照片（{pics.length}）</span>
          <button onClick={() => photoInput.current?.click()} disabled={busy} className="btn-outline text-xs disabled:opacity-40">＋ 加照片</button>
          <input ref={photoInput} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { handleFiles('photo', e.target.files); e.target.value = ''; }} />
        </div>
        {pics.length > 0 ? grid(pics) : <p className="text-[11px] text-ink-3">尚無照片，可存車輛、證件、交車現場等。</p>}
      </div>

      {busy && <p className="text-xs text-accent">處理中…</p>}
      <p className="text-[10px] text-ink-3">照片只存在這台裝置（不上傳雲端、不佔同步空間），上傳時自動壓縮省空間；刪除客戶會一併刪除照片。</p>

      {/* 放大檢視 */}
      {viewerPhoto && (
        <div className="fixed inset-0 z-[60] bg-black flex items-center justify-center anim-fade-in" onClick={() => setViewer(null)}>
          <img src={urlFor(viewerPhoto)} alt="" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setViewer(null)} className="absolute top-3 right-4 text-white/90 text-3xl leading-none">✕</button>
          <button onClick={(e) => { e.stopPropagation(); remove(viewerPhoto.id); }}
            className="absolute bottom-5 left-1/2 -translate-x-1/2 btn-danger text-sm">🗑 刪除這張</button>
        </div>
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { db } from '../../db';
import { subscribeSyncStatus } from '../../sync';
import {
  downloadCloudPhoto, isPhotoSyncEnabled, queuePhotoDelete, uploadCloudPhoto,
} from '../../photoSync';
import { compressImage, formatBytes } from '../../utils/image';
import { generateId } from '../../utils/crm';

/**
 * 照片 Blob 存在本機 IndexedDB；啟用照片雲端後上傳 R2，只有 photoMeta 小型索引
 * 進入 GitHub data.json。其他裝置開啟客戶時才下載原圖並保留本機快取。
 */
export default function ClientPhotos({ clientId }) {
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [viewer, setViewer] = useState(null);
  const urlsRef = useRef(new Map());
  const cardInput = useRef(null);
  const photoInput = useRef(null);

  const urlFor = (photo) => {
    if (!photo.blob) return '';
    if (!urlsRef.current.has(photo.id)) {
      urlsRef.current.set(photo.id, URL.createObjectURL(photo.blob));
    }
    return urlsRef.current.get(photo.id);
  };

  useEffect(() => {
    let alive = true;
    let loading = false;
    const urls = urlsRef.current;

    async function load() {
      if (loading) return;
      loading = true;
      try {
        const [local, metas] = await Promise.all([db.getPhotos(clientId), db.getPhotoMeta(clientId)]);
        const metaById = new Map(metas.map((meta) => [meta.id, meta]));
        const merged = local.map((photo) => ({ ...photo, ...(metaById.get(photo.id) || {}) }));
        const localIds = new Set(local.map((photo) => photo.id));
        for (const meta of metas) {
          if (!localIds.has(meta.id)) merged.push({ ...meta, cloudOnly: true });
        }
        merged.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        if (alive) setPhotos(merged);

        if (isPhotoSyncEnabled()) {
          for (const meta of merged.filter((photo) => photo.cloudOnly && !photo.blob)) {
            try {
              const downloaded = await downloadCloudPhoto(meta);
              if (alive) {
                setPhotos((current) => current.map((photo) => (
                  photo.id === meta.id ? downloaded : photo
                )));
              }
            } catch (error) {
              if (alive) setMessage(`❌ ${error.message}`);
            }
          }
        }
      } catch {
        // 照片區失敗不影響客戶主資料。
      } finally {
        loading = false;
      }
    }

    load();
    const unsubscribe = subscribeSyncStatus((status) => {
      if (status.state === 'ok') load();
    });
    return () => {
      alive = false;
      unsubscribe();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [clientId]);

  async function addFiles(fileList, kind) {
    const files = [...(fileList || [])].filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    setBusy(true);
    setMessage('');
    try {
      const added = [];
      for (const file of files) {
        let blob = file;
        let w = 0;
        let h = 0;
        try {
          const compressed = await compressImage(file, kind === 'card'
            ? { maxDim: 1800, quality: 0.78 }
            : { maxDim: 1600, quality: 0.72 });
          blob = compressed.blob;
          w = compressed.w;
          h = compressed.h;
        } catch { /* 壓縮失敗就保留原檔 */ }
        const photo = {
          id: generateId('photo'),
          clientId,
          kind,
          blob,
          size: blob.size,
          w,
          h,
          name: file.name || '',
          createdAt: new Date().toISOString(),
        };
        await db.putPhoto(photo);
        if (isPhotoSyncEnabled()) {
          try {
            const meta = await uploadCloudPhoto(photo);
            added.push({ ...photo, ...meta });
          } catch (error) {
            added.push(photo);
            setMessage(`❌ 已保留在本機，但雲端上傳失敗：${error.message}。連線恢復後會自動續傳。`);
          }
        } else {
          added.push(photo);
        }
      }
      setPhotos((current) => {
        const byId = new Map(current.map((photo) => [photo.id, photo]));
        for (const photo of added) byId.set(photo.id, photo);
        return [...byId.values()].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      });
    } finally {
      setBusy(false);
    }
  }

  async function syncUnsynced() {
    const pending = photos.filter((photo) => photo.blob && !photo.cloud);
    if (!pending.length || !isPhotoSyncEnabled()) return;
    setBusy(true);
    setMessage('');
    let done = 0;
    try {
      for (const photo of pending) {
        const meta = await uploadCloudPhoto(photo);
        done += 1;
        setPhotos((current) => current.map((item) => (
          item.id === photo.id ? { ...item, ...meta } : item
        )));
      }
      setMessage(`✅ 已上傳 ${done} 張照片`);
    } catch (error) {
      setMessage(`❌ 已完成 ${done} 張；其餘稍後續傳：${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    const target = photos.find((photo) => photo.id === id);
    if (!target) return;
    const cloudMeta = target.cloud ? target : await db.get('photoMeta', id).catch(() => null);
    if (cloudMeta) await queuePhotoDelete({ ...target, ...cloudMeta });
    else await db.deletePhoto(id);
    const url = urlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urlsRef.current.delete(id);
    }
    setPhotos((current) => current.filter((photo) => photo.id !== id));
    if (viewer === id) setViewer(null);
  }

  const viewerPhoto = photos.find((photo) => photo.id === viewer);
  const cards = photos.filter((photo) => photo.kind === 'card');
  const pics = photos.filter((photo) => photo.kind === 'photo');
  const unsyncedCount = photos.filter((photo) => photo.blob && !photo.cloud).length;
  const totalSize = photos.reduce((sum, photo) => sum + (photo.size || photo.blob?.size || 0), 0);
  const cloudEnabled = isPhotoSyncEnabled();

  const grid = (list) => (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {list.map((photo) => (
        <div key={photo.id} className="relative group rounded-lg overflow-hidden bg-s3 border border-bdr" style={{ aspectRatio: '1 / 1' }}>
          {photo.blob ? (
            <img src={urlFor(photo)} alt="" loading="lazy" className="w-full h-full object-cover cursor-pointer"
              onClick={() => setViewer(photo.id)} />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-ink-3 text-[10px] text-center px-2">
              <span className="text-xl">☁️</span><span>需設定照片雲端才能下載</span>
            </div>
          )}
          {photo.cloud && <span className="absolute bottom-1 left-1 rounded bg-black/55 text-white text-[9px] px-1">☁</span>}
          <button onClick={() => remove(photo.id)}
            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white text-xs flex items-center justify-center md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            ✕
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-3">{photos.length} 張 · {formatBytes(totalSize)}</span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-2">💳 名片（{cards.length}）</span>
          <button onClick={() => cardInput.current?.click()} disabled={busy} className="btn-outline text-[11px] py-1 px-2">＋ 加名片</button>
          <input ref={cardInput} type="file" accept="image/*" multiple className="hidden"
            onChange={(event) => { addFiles(event.target.files, 'card'); event.target.value = ''; }} />
        </div>
        {cards.length > 0 ? grid(cards) : <p className="text-[11px] text-ink-3">尚無名片，點「加名片」拍照或從相簿選。</p>}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-2">🖼 照片（{pics.length}）</span>
          <button onClick={() => photoInput.current?.click()} disabled={busy} className="btn-outline text-[11px] py-1 px-2">＋ 加照片</button>
          <input ref={photoInput} type="file" accept="image/*" multiple className="hidden"
            onChange={(event) => { addFiles(event.target.files, 'photo'); event.target.value = ''; }} />
        </div>
        {pics.length > 0 ? grid(pics) : <p className="text-[11px] text-ink-3">尚無照片，可存車輛、證件、交車現場等。</p>}
      </div>

      {cloudEnabled && unsyncedCount > 0 && (
        <button onClick={syncUnsynced} disabled={busy} className="btn-outline text-xs w-full disabled:opacity-40">
          ☁️ 上傳這位客戶尚未同步的 {unsyncedCount} 張
        </button>
      )}
      {busy && <p className="text-xs text-accent">處理中…</p>}
      {message && <p className="text-xs text-ink-2 bg-s2 rounded-lg px-3 py-2">{message}</p>}
      <p className="text-[10px] text-ink-3">
        {cloudEnabled
          ? '☁️ 已啟用跨裝置：原圖存物件雲端，本機保留快取；客戶資料同步檔只含小型索引。'
          : '照片目前只存在這台裝置；可到「設定 → 雲端同步 → 照片跨裝置」啟用。'}
      </p>

      {viewerPhoto?.blob && (
        <div className="fixed inset-0 z-[60] bg-black flex items-center justify-center anim-fade-in" onClick={() => setViewer(null)}>
          <img src={urlFor(viewerPhoto)} alt="" className="max-w-full max-h-full object-contain" onClick={(event) => event.stopPropagation()} />
          <button onClick={() => setViewer(null)} className="absolute top-3 right-4 text-white/90 text-3xl leading-none">✕</button>
        </div>
      )}
    </div>
  );
}

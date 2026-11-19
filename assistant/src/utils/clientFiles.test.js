import test from 'node:test';
import assert from 'node:assert/strict';
import { photoScope, fileIcon, MAX_FILE_BYTES } from './clientFiles.js';

test('客戶頁看得到全部；案件裡只看這個案件的＋客戶共用的', () => {
  const rows = [
    { id: 1, kind: 'photo', caseId: 'A' }, { id: 2, kind: 'photo', caseId: 'B' },
    { id: 3, kind: 'photo', caseId: null }, { id: 4, kind: 'card', caseId: null }, { id: 5, kind: 'file', caseId: 'A' },
  ];
  assert.deepEqual(rows.filter((r) => photoScope(r) !== 'hidden').map((r) => r.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(rows.filter((r) => photoScope(r, 'A') !== 'hidden').map((r) => r.id), [1, 3, 5]); // 看不到別案件的 B，也不放名片
  assert.deepEqual(rows.filter((r) => photoScope(r, 'B') !== 'hidden').map((r) => r.id), [2, 3]);
  assert.equal(photoScope({ kind: 'photo', caseId: null }, 'A'), 'shared');
});

test('檔案圖示與上限', () => {
  assert.equal(fileIcon('合約.pdf'), '📕');
  assert.equal(fileIcon('報價.xlsx'), '📗');
  assert.equal(fileIcon('x.docx'), '📘');
  assert.equal(fileIcon('未知檔'), '📄');
  assert.equal(MAX_FILE_BYTES, 20971520);
});

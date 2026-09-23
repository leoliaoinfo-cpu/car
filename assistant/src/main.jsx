import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AppProvider } from './context';
import { STORAGE_KEYS } from './storageKeys';

// 在 React 畫面出現前還原本機主題，避免重開 APP 後按鈕顯示深色，畫面卻還是淺色。
try {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.theme) || 'dark';
  document.documentElement.classList.toggle('dark', savedTheme === 'dark');
} catch {
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    // es2015 相容性更好，避免 file:// 的 esnext 限制
    target: 'es2015',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    outDir: 'dist',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        // IIFE 格式：不需要 type="module"，file:// 直接雙擊也能跑
        format: 'iife',
      },
    },
  },
});

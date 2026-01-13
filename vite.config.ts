import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 显式指定仓库路径，解决 GitHub 子目录部署 404 问题
  base: '/-SeisNorm-app/', 
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  }
});

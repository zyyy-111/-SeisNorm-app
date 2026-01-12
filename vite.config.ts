
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 使用 './' 使得构建出的资源使用相对路径，
  // 这样无论部署在根目录还是子目录下（如 /SeisNorm-app/）都能正确加载
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // 产生 sourcemaps 方便调试
    sourcemap: true,
  }
});

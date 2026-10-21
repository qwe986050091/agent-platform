import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite 开发服务器：把 /api 请求代理到后端，避免跨域问题
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
  build: {
    // antd 生态本身体量较大（gzip 后约 300kB），阈值相应放宽
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // 手动分包：把稳定的第三方依赖拆成独立 chunk，业务改动不会让它们的缓存失效
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (
            id.includes('/antd/') ||
            id.includes('/@ant-design/') ||
            id.includes('/rc-') ||
            id.includes('/@rc-component/')
          ) {
            return 'antd'
          }
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router') ||
            id.includes('/scheduler/')
          ) {
            return 'react-vendor'
          }
          return 'vendor'
        },
      },
    },
  },
})

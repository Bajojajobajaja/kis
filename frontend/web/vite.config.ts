import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/gateway': {
        target: 'http://localhost:19081',
        changeOrigin: true,
      },
      '/svc/service-workorders': {
        target: 'http://localhost:19105',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/svc\/service-workorders/, ''),
      },
      '/svc/service-parts-usage': {
        target: 'http://localhost:19104',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/svc\/service-parts-usage/, ''),
      },
      '/svc/inventory-stock': {
        target: 'http://localhost:19093',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/svc\/inventory-stock/, ''),
      },
      '/svc/inventory-procurement': {
        target: 'http://localhost:19091',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/svc\/inventory-procurement/, ''),
      },
      '/svc/finance-reporting': {
        target: 'http://localhost:19088',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/svc\/finance-reporting/, ''),
      },
      '/svc/sales-documents': {
        target: 'http://localhost:19099',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/svc\/sales-documents/, ''),
      },
    },
  },
})

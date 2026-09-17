import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4317,
    strictPort: true,
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:4318',
        ws: true,
      },
      '/api': 'http://127.0.0.1:4318',
    },
  },
})

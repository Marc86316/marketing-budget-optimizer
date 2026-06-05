import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/marketing-budget-optimizer/', // 💡 檢查這裡！前後一定要有 / 
})
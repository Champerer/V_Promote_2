import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // This ensures process.env is accessible in the browser for the API key
    'process.env': process.env
  }
})
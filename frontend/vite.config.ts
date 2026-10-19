import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Fixed port so `npm run dev` needs no extra flags (PowerShell drops `--`).
  // strictPort: fail loudly instead of drifting to another port.
  server: { port: 5174, strictPort: true },
})

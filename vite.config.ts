import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import deadFile from 'vite-plugin-deadfile';


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), deadFile({ 
    root: 'src',
    exclude: [
      '**/main.tsx',
      '**/index.ts',
      '**/App.tsx',
      '**/*.css',
      '**/vite-env.d.ts',
      '**/defaultPrompts.json',
      '**/hooks/*.ts',
    ]
  })],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          antd: ['antd', '@ant-design/icons'],
          ffmpeg: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
          audio: ['react-audio-voice-recorder'],
          ai: ['groq-sdk', 'openai']
        }
      }
    },
    sourcemap: true,
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});

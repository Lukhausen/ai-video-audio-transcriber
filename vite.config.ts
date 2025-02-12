import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import deadFile from 'vite-plugin-deadfile';


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), deadFile({ root: 'src' })],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});

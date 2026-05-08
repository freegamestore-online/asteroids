import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({ registerType: 'autoUpdate', workbox: { skipWaiting: true, clientsClaim: true, globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'] }, manifest: { name: 'Asteroids', short_name: 'Asteroids', description: 'Asteroids — free forever', start_url: '/', display: 'standalone', background_color: '#0f0f0f', theme_color: '#10b981', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] } })],
});

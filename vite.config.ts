import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build can be served from any path, including inside the portfolio site.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // Two pages: the app, and the plain-language About page.
  build: { rollupOptions: { input: { main: "index.html", about: "about.html" } } },
});

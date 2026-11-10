import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build can be served from any path, including inside the portfolio site.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // Pages: the app, the plain-language About page, the unlisted listening study (rate/) and the trial second version (v2/).
  build: { rollupOptions: { input: { main: "index.html", about: "about.html", rate: "rate/index.html", v2: "v2/index.html" } } },
});

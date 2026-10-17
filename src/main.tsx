import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// The original detailed view stays available for demos: ?classic, #classic, or ?embed.
const q = new URLSearchParams(window.location.search);
const classic = q.has("classic") || q.has("embed") || ["#classic", "#embed"].includes(window.location.hash);
const View = lazy(() => (classic ? import("./App") : import("./minimal/Minimal")));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <View />
    </Suspense>
  </StrictMode>,
);

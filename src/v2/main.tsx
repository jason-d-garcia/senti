import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import V2 from "./V2";
import "./v2.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <V2 />
    <Analytics />
  </StrictMode>,
);

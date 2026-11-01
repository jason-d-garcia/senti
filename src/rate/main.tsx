import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { Rate } from "./Rate";
import "./rate.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Rate />
    <Analytics />
  </StrictMode>,
);

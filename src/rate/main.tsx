import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Rate } from "./Rate";
import "./rate.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Rate />
  </StrictMode>,
);

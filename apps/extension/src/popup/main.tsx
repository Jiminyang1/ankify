import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";
import { Popup } from "./Popup";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  );
}

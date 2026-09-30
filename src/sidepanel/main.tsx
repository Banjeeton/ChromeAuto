import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./design-system/tokens.css";
import "./design-system/components.css";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Side panel root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

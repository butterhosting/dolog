import { createRoot } from "react-dom/client";
import { Website } from "./Website";
import "./index.css";

function start() {
  const root = createRoot(document.getElementById("root")!);
  root.render(<Website />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}

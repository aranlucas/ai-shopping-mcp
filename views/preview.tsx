import { createRoot } from "react-dom/client";
import { Preview } from "./preview-app.js";

if (import.meta.env.DEV) {
  const element = document.querySelector("#root");

  if (!element) {
    throw new Error("Preview root element is missing");
  }

  const root = createRoot(element);
  root.render(<Preview />);
  import.meta.hot?.dispose(() => root.unmount());
}

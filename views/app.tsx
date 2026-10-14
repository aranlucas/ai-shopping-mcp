import { createRoot } from "react-dom/client";
import { ShoppingApp } from "./shopping-app.js";

const rootElement = document.querySelector("#root");

if (!rootElement) {
  throw new Error("Shopping app root element is missing");
}

createRoot(rootElement).render(<ShoppingApp />);

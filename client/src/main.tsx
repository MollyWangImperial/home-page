import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializeReviewAccount } from "./lib/review-account";

initializeReviewAccount(window.location.origin, () => ({ local: localStorage, session: sessionStorage }));

createRoot(document.getElementById("root")!).render(<App />);

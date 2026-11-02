import React from "react";
import { createRoot } from "react-dom/client";
import TraceBar from "./TraceBar";
import "./trace-bar.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TraceBar />
  </React.StrictMode>,
);

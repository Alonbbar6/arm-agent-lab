import { useEffect, useState } from "react";
import type { LabMode } from "@/lib/lab";
// The laboratory and evaluation tab share the user's explicit mode selection.
export function useLabMode(claudeAvailable: boolean) {
  const [mode, setMode] = useState<LabMode>(() => sessionStorage.getItem("lab-mode") === "claude" ? "claude" : "mock");
  useEffect(() => {
    const preference = sessionStorage.getItem("lab-mode");
    setMode(claudeAvailable && preference !== "mock" ? "claude" : "mock");
  }, [claudeAvailable]);
  const select = (next: LabMode) => {
    sessionStorage.setItem("lab-mode", next);
    setMode(next === "claude" && !claudeAvailable ? "mock" : next);
  };
  return [mode, select] as const;
}

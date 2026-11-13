import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

// true när användaren slagit på "Reducera rörelse" (iOS) / "Ta bort animationer"
// (Android). Används för att stänga av effekter som rör sig hela tiden, t.ex.
// kortbuntens djup och glansen på belöningskort.
export default function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    try {
      AccessibilityInfo.isReduceMotionEnabled?.()
        .then((v) => { if (alive) setReduce(!!v); })
        .catch(() => {});
    } catch {}
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v) => setReduce(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduce;
}

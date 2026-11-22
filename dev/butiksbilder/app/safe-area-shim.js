// Attrapp för react-native-safe-area-context i webbversionen: fasta insets som på en riktig telefon
// (statusrad och hemindikator), så att appen lägger sig som på enheten.
import React, { createContext, useContext } from "react";
import { View } from "react-native";

const fixed = () => (typeof window !== "undefined" && window.__SHOT_INSETS__) || { top: 0, bottom: 0, left: 0, right: 0 };
const Ctx = createContext(null);

export function SafeAreaProvider({ children, style }) {
  return <Ctx.Provider value={fixed()}><View style={[{ flex: 1 }, style]}>{children}</View></Ctx.Provider>;
}
export function useSafeAreaInsets() { return useContext(Ctx) || fixed(); }
export function useSafeAreaFrame() {
  return { x: 0, y: 0, width: typeof window !== "undefined" ? window.innerWidth : 0, height: typeof window !== "undefined" ? window.innerHeight : 0 };
}
export function SafeAreaView({ edges, style, children, ...rest }) {
  const ins = useSafeAreaInsets();
  const e = Array.isArray(edges) ? edges : edges && typeof edges === "object" ? Object.keys(edges) : ["top", "bottom", "left", "right"];
  const pad = {
    paddingTop: e.includes("top") ? ins.top : 0,
    paddingBottom: e.includes("bottom") ? ins.bottom : 0,
    paddingLeft: e.includes("left") ? ins.left : 0,
    paddingRight: e.includes("right") ? ins.right : 0,
  };
  return <View style={[style, pad]} {...rest}>{children}</View>;
}
export const SafeAreaInsetsContext = Ctx;
export const initialWindowMetrics = null;

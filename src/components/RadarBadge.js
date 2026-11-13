import React, { useEffect, useRef } from "react";
import { Animated, Easing, View, ActivityIndicator } from "react-native";
import { T } from "../lib/theme";
import BrandMark from "./BrandMark";

// Radarvågor som i TapPass-symbolen: en mörk bricka med limepunkten och bågarna,
// och ringar som sänds ut medan telefonen lyssnar efter en stämpel.
export default function RadarBadge({ size = 44, active = true, busy = false }) {
  const w1 = useRef(new Animated.Value(0)).current;
  const w2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || busy) { w1.stopAnimation(); w2.stopAnimation(); w1.setValue(0); w2.setValue(0); return; }
    const wave = (v) => Animated.loop(Animated.timing(v, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    const a1 = wave(w1);
    const a2 = wave(w2);
    a1.start();
    const t = setTimeout(() => a2.start(), 1000);   // andra vågen en halv period efter
    return () => { clearTimeout(t); a1.stop(); a2.stop(); };
  }, [active, busy]);

  const ring = (v) => (
    <Animated.View style={{
      position: "absolute", width: size, height: size, borderRadius: size / 2,
      borderWidth: 2, borderColor: T.primary,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 2.0] }) }],
    }} />
  );

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {active && !busy && ring(w1)}
      {active && !busy && ring(w2)}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: T.ink, alignItems: "center", justifyContent: "center" }}>
        {busy
          ? <ActivityIndicator size="small" color={T.lime} />
          : <BrandMark size={Math.round(size * 0.62)} animated={active} arcColor={T.bg} dotColor={T.lime} />}
      </View>
    </View>
  );
}

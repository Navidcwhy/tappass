import React, { useEffect, useRef } from "react";
import { View, Animated } from "react-native";
import { Check } from "lucide-react-native";
import Shape from "./Shape";

// Stämplar som mjuka "kak"-former: fyllda med bock, tomma i butikens dekorton.
// popIndex = stämpeln som just kom till (studsar in och får en solform bakom sig).
export default function StampRow({ total, filled, tone, size = 28, gap = 8, popIndex = -1 }) {
  const n = Math.max(0, total | 0);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap }}>
      {Array.from({ length: n }).map((_, i) => (
        <Stamp key={i} on={i < filled} tone={tone} size={size} pop={i === popIndex} />
      ))}
    </View>
  );
}

function Stamp({ on, tone, size, pop }) {
  const scale = useRef(new Animated.Value(pop ? 0.2 : 1)).current;
  useEffect(() => {
    if (!pop) return;
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 90, delay: 250, useNativeDriver: true }).start();
  }, [pop]);

  const stamp = (
    <Shape kind="cookie9" size={size} color={on ? tone.primary : tone.deco}>
      {on && <Check size={Math.round(size * 0.5)} color="#FFFFFF" strokeWidth={3.5} />}
    </Shape>
  );

  if (!pop) return stamp;
  const halo = Math.round(size * 1.4);
  return (
    <View style={{ width: halo, height: halo, alignItems: "center", justifyContent: "center", margin: -(halo - size) / 2 }}>
      <Shape kind="sunny8" size={halo} color={tone.container} style={{ position: "absolute" }} />
      <Animated.View style={{ transform: [{ scale }] }}>{stamp}</Animated.View>
    </View>
  );
}

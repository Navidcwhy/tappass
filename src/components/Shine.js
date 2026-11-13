import React, { useEffect, useRef } from "react";
import { Animated, Easing, Dimensions } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { T } from "../lib/theme";

const BAND = 120;      // bandets bredd (px)
const PERIOD = 5200;   // ms per svep inklusive paus

// Holografisk glans över ett kort med belöning: ett ljust band med en limekant
// sveper snett över kortet med jämna mellanrum. offset (Animated-nod i px)
// flyttar bandet när listan skrollas, som när man vinklar ett hologram.
// still = ingen loop (Reducera rörelse); bandet ligger då stilla mitt på.
// Läggs som barn i en vy med overflow: "hidden" och rundade hörn.
export default function Shine({ width = Dimensions.get("window").width - 32, offset, still = false }) {
  const p = useRef(new Animated.Value(still ? 0.26 : 0)).current;   // 0.26 ≈ mitt på kortet

  useEffect(() => {
    if (still) return;
    const a = Animated.loop(Animated.timing(p, { toValue: 1, duration: PERIOD, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [still]);

  // Bandet väntar utanför kortet, sveper över under drygt en sekund och väntar igen.
  // Mjuk start och landning med extra punkter (native-interpolering är linjär).
  const out = -BAND * 3, home = width + BAND * 2;   // helt utanför även med offset ±70 och lutning
  const sweep = p.interpolate({
    inputRange: [0, 0.16, 0.2, 0.32, 0.38, 1],
    outputRange: [out, out, out + (home - out) * 0.12, out + (home - out) * 0.86, home, home],
  });
  const x = offset ? Animated.add(sweep, offset) : sweep;

  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", top: -70, bottom: -70, left: 0, width: BAND, transform: [{ translateX: x }, { rotate: "16deg" }] }}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="tappassShine" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
            <Stop offset="0.38" stopColor="#FFFFFF" stopOpacity="0.32" />
            <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.55" />
            <Stop offset="0.6" stopColor={T.lime} stopOpacity="0.42" />
            <Stop offset="0.72" stopColor={T.lime} stopOpacity="0.12" />
            <Stop offset="1" stopColor={T.lime} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#tappassShine)" />
      </Svg>
    </Animated.View>
  );
}

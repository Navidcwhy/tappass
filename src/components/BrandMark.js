import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { T } from "../lib/theme";

// TapPass-symbolen (lime-punkt + två radarbågar) som vektor — samma geometri
// som app-ikonen. animated ger en "sändande" puls i bågarna.
const ARC_INNER = "M45 32.9 A40 40 0 0 1 68 57.6";
const ARC_OUTER = "M53.2 12.5 A62 62 0 0 1 89 50.8";

function ArcLayer({ d, color, size, strokeWidth }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: "absolute", top: 0, left: 0 }}>
      <Path d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export default function BrandMark({ size = 28, animated = false, arcColor = T.ink, dotColor = T.accent, strokeWidth = 10 }) {
  const inner = useRef(new Animated.Value(1)).current;
  const outer = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!animated) { inner.setValue(1); outer.setValue(1); return; }
    const make = (v, delay) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 0.2, duration: 850, useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 850, useNativeDriver: true }),
      ]));
    const a1 = make(inner, 0);
    const a2 = make(outer, 320);
    a1.start();
    a2.start();
    return () => { a1.stop(); a2.stop(); };
  }, [animated]);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx="30" cy="70" r="17" fill={dotColor} />
      </Svg>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, opacity: inner }}>
        <ArcLayer d={ARC_INNER} color={arcColor} size={size} strokeWidth={strokeWidth} />
      </Animated.View>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, opacity: outer }}>
        <ArcLayer d={ARC_OUTER} color={arcColor} size={size} strokeWidth={strokeWidth} />
      </Animated.View>
    </View>
  );
}

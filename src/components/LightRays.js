import React, { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import Svg, { Defs, RadialGradient, Stop, Path } from "react-native-svg";
import { T } from "../lib/theme";

const RAYS = 14;
const WIDTH = 11;   // grader per stråle

// Strålarna som trianglar från mitten (viewBox 200 × 200).
const PATHS = Array.from({ length: RAYS }, (_, i) => {
  const a = (i * 360) / RAYS;
  const p = (deg) => {
    const r = (deg * Math.PI) / 180;
    return (100 + 100 * Math.sin(r)).toFixed(1) + " " + (100 - 100 * Math.cos(r)).toFixed(1);
  };
  return "M100 100 L" + p(a - WIDTH / 2) + " L" + p(a + WIDTH / 2) + " Z";
});

// Ljusstrålar bakom hjulet vid vinst: växer fram och snurrar sakta. Tonar ut mot
// kanten, så att de inte tävlar med texten runt hjulet. Spelas när komponenten monteras.
export default function LightRays({ size, color = T.lime }) {
  const show = useRef(new Animated.Value(0)).current;
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(show, { toValue: 1, friction: 6, tension: 40, useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 12000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View pointerEvents="none" style={{
      width: size, height: size,
      opacity: show.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
      transform: [
        { scale: show.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) },
        { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
      ],
    }}>
      <Svg width={size} height={size} viewBox="0 0 200 200">
        <Defs>
          <RadialGradient id="tappassRays" cx="100" cy="100" r="100" gradientUnits="userSpaceOnUse">
            <Stop offset="0.3" stopColor={color} stopOpacity="1" />
            <Stop offset="0.72" stopColor={color} stopOpacity="0.9" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {PATHS.map((d, i) => <Path key={i} d={d} fill="url(#tappassRays)" />)}
      </Svg>
    </Animated.View>
  );
}

import React, { useEffect, useRef } from "react";
import { Animated, Easing, View, Dimensions } from "react-native";
import Shape from "./Shape";

const KINDS = ["cookie9", "sunny8", "clover4", "flower8", "pill"];

// Konfetti av mjuka former som faller, driver och snurrar en gång.
export default function Confetti({ count = 26, colors = ["#56642B", "#CBDB98", "#FFFFFF", "#C9EE6B"] }) {
  const { width, height } = Dimensions.get("window");
  const items = useRef(
    Array.from({ length: count }).map((_, i) => ({
      y: new Animated.Value(0),
      o: new Animated.Value(1),
      left: Math.random() * width,
      dx: (Math.random() * 2 - 1) * 70,
      dy: height * (0.55 + Math.random() * 0.45),
      rot: Math.round((Math.random() * 2 - 1) * 540),
      dur: 1700 + Math.random() * 1300,
      delay: Math.random() * 450,
      kind: KINDS[i % KINDS.length],
      color: colors[i % colors.length],
      size: 10 + Math.random() * 12,
    }))
  ).current;

  useEffect(() => {
    const anims = items.map((it) => Animated.parallel([
      Animated.timing(it.y, { toValue: 1, duration: it.dur, delay: it.delay, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(it.o, { toValue: 0, duration: 500, delay: it.delay + it.dur - 500, useNativeDriver: true }),
    ]));
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);

  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, overflow: "hidden" }}>
      {items.map((it, i) => (
        <Animated.View key={i} style={{
          position: "absolute",
          left: it.left,
          top: -30,
          opacity: it.o,
          transform: [
            { translateY: it.y.interpolate({ inputRange: [0, 1], outputRange: [0, it.dy] }) },
            { translateX: it.y.interpolate({ inputRange: [0, 1], outputRange: [0, it.dx] }) },
            { rotate: it.y.interpolate({ inputRange: [0, 1], outputRange: ["0deg", it.rot + "deg"] }) },
          ],
        }}>
          {it.kind === "pill"
            ? <View style={{ width: Math.round(it.size * 0.45), height: Math.round(it.size * 1.25), borderRadius: it.size, backgroundColor: it.color }} />
            : <Shape kind={it.kind} size={Math.round(it.size)} color={it.color} />}
        </Animated.View>
      ))}
    </View>
  );
}

import React, { useEffect, useRef } from "react";
import { Animated, Easing, View, Text, Dimensions } from "react-native";

const COLORS = ["#E8B04B", "#CBEB57", "#F05A6E", "#1C6470", "#fff"];

export default function Confetti({ emoji = "🎉", count = 32 }) {
  const { width } = Dimensions.get("window");
  const items = useRef(
    Array.from({ length: count }).map((_, i) => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      r: new Animated.Value(0),
      o: new Animated.Value(1),
      dx: (Math.random() * 2 - 1) * (width * 0.45),
      dy: 320 + Math.random() * 220,
      rot: (Math.random() * 2 - 1) * 720,
      dur: 1000 + Math.random() * 900,
      delay: Math.random() * 250,
      left: 25 + Math.random() * 50,
      isEmoji: i % 3 === 0,
      color: COLORS[i % COLORS.length],
      size: 6 + Math.random() * 6,
      tall: Math.random() > 0.5,
    }))
  ).current;

  useEffect(() => {
    items.forEach((it) => {
      Animated.parallel([
        Animated.timing(it.x, { toValue: it.dx, duration: it.dur, delay: it.delay, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(it.y, { toValue: it.dy, duration: it.dur, delay: it.delay, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(it.r, { toValue: it.rot, duration: it.dur, delay: it.delay, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(it.o, { toValue: 0, duration: it.dur, delay: it.delay + 200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start();
    });
  }, []);

  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 60, bottom: 0, overflow: "hidden", zIndex: 60 }}>
      {items.map((it, i) => (
        <Animated.View key={i} style={{
          position: "absolute",
          left: `${it.left}%`,
          opacity: it.o,
          transform: [{ translateX: it.x }, { translateY: it.y }, { rotate: it.r.interpolate({ inputRange: [-720, 720], outputRange: ["-720deg", "720deg"] }) }],
        }}>
          {it.isEmoji
            ? <Text style={{ fontSize: 16 }}>{i % 2 ? "✨" : emoji}</Text>
            : <View style={{ width: it.size, height: it.tall ? it.size * 1.9 : it.size, backgroundColor: it.color, borderRadius: it.tall ? 2 : it.size }} />}
        </Animated.View>
      ))}
    </View>
  );
}

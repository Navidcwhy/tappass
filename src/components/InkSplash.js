import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Shape from "./Shape";

// Bläckstänk när en stämpel landar: små prickar och kakformer skjuts ut från
// mitten och tonar bort. Spelas en gång när komponenten monteras — byt key för
// att spela igen. Läggs i en förälder med position: relative (stänket utgår från mitten).
export default function InkSplash({ colors, count = 12, radius = 92, delay = 0 }) {
  const parts = useRef(
    Array.from({ length: count }).map((_, i) => {
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist = radius * (0.65 + Math.random() * 0.45);
      return {
        p: new Animated.Value(0),
        dx: Math.cos(a) * dist,
        dy: Math.sin(a) * dist,
        s: 7 + Math.random() * 9,
        cookie: i % 3 === 0,
        color: colors[i % colors.length],
        dur: 520 + Math.random() * 220,
      };
    })
  ).current;

  useEffect(() => {
    const anim = Animated.parallel(parts.map((it) =>
      Animated.timing(it.p, { toValue: 1, duration: it.dur, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    ));
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View pointerEvents="none" style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0 }}>
      {parts.map((it, i) => (
        <Animated.View key={i} style={{
          position: "absolute",
          left: -it.s / 2,
          top: -it.s / 2,
          opacity: it.p.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 0.9, 0] }),
          transform: [
            { translateX: it.p.interpolate({ inputRange: [0, 1], outputRange: [0, it.dx] }) },
            { translateY: it.p.interpolate({ inputRange: [0, 1], outputRange: [0, it.dy] }) },
            { scale: it.p.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.2, 1.1, 0.55] }) },
          ],
        }}>
          {it.cookie
            ? <Shape kind="cookie9" size={Math.round(it.s * 1.3)} color={it.color} />
            : <View style={{ width: it.s, height: it.s, borderRadius: it.s / 2, backgroundColor: it.color }} />}
        </Animated.View>
      ))}
    </View>
  );
}

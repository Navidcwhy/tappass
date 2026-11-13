import React, { useEffect, useState } from "react";
import { Animated, Easing, View, Dimensions } from "react-native";
import Shape from "./Shape";

const STEPS = 60;   // nyckelrutor per bit (svajet räknas ut i förväg)
const INPUT = Array.from({ length: STEPS + 1 }, (_, i) => i / STEPS);
const rnd = (a, b) => a + Math.random() * (b - a);

// Säsongsdetalj: snö, fjädrar, kronblad eller bullar som singlar ner en gång över
// skärmen när appen öppnas — långsamt, med svaj och lite snurr. Tar aldrig emot tryck.
// Inställningarna kommer från seasonFor() i lib/season.js:
//   kinds  — former ur shapes.js, "pill" (fjäder) eller "dot" (prick)
//   speed  — fallhastighet px/s [min, max]
//   size   — px [min, max]
//   spin   — högst så många grader per sekund
//   spread — under hur många ms bitarna släpps
export default function SeasonFall({ kinds = ["dot"], colors = ["#B8CADC"], count = 22, speed = [55, 95], size = [8, 16], spin = 60, spread = 4500 }) {
  const [items] = useState(() => {
    const { width: W, height: H } = Dimensions.get("window");
    return Array.from({ length: count }, (_, i) => {
      const secs = (H + 90) / rnd(speed[0], speed[1]);
      const x0 = rnd(0, W), amp = rnd(8, 24), period = rnd(2.4, 4.4), ph = rnd(0, Math.PI * 2);
      const r0 = rnd(0, 360), turn = rnd(-spin, spin) * secs;
      return {
        p: new Animated.Value(0),
        dur: Math.round(secs * 1000),
        delay: Math.round(rnd(0, spread)),
        xs: INPUT.map((k) => x0 + amp * Math.sin((2 * Math.PI * k * secs) / period + ph)),
        y0: -rnd(20, 60), y1: H + 30,
        rots: [r0 + "deg", (r0 + turn).toFixed(1) + "deg"],
        kind: kinds[i % kinds.length],
        color: colors[Math.floor(Math.random() * colors.length)],
        s: Math.round(rnd(size[0], size[1])),
      };
    });
  });

  useEffect(() => {
    const anims = items.map((it) => Animated.timing(it.p, { toValue: 1, duration: it.dur, delay: it.delay, easing: Easing.linear, useNativeDriver: true }));
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);

  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, overflow: "hidden" }}>
      {items.map((it, i) => (
        <Animated.View key={i} style={{
          position: "absolute", left: -it.s / 2, top: 0,
          opacity: it.p.interpolate({ inputRange: [0, 0.03, 0.85, 1], outputRange: [0, 0.9, 0.9, 0] }),
          transform: [
            { translateX: it.p.interpolate({ inputRange: INPUT, outputRange: it.xs }) },
            { translateY: it.p.interpolate({ inputRange: [0, 1], outputRange: [it.y0, it.y1] }) },
            { rotate: it.p.interpolate({ inputRange: [0, 1], outputRange: it.rots }) },
          ],
        }}>
          {it.kind === "dot"
            ? <View style={{ width: Math.round(it.s * 0.55), height: Math.round(it.s * 0.55), borderRadius: it.s, backgroundColor: it.color }} />
            : it.kind === "pill"
              ? <View style={{ width: Math.round(it.s * 0.4), height: Math.round(it.s * 1.3), borderRadius: it.s, backgroundColor: it.color }} />
              : <Shape kind={it.kind} size={it.s} color={it.color} />}
        </Animated.View>
      ))}
    </View>
  );
}

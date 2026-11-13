import React, { useEffect, useRef } from "react";
import { View, Animated, Easing } from "react-native";
import { Check, Gift } from "lucide-react-native";
import { T } from "../lib/theme";
import Shape from "./Shape";

// Stämplar som mjuka "kak"-former: fyllda med bock, tomma i butikens dekorton.
//   pops      — [{ index, delay }]: stämplar som just kom till och studsar in, i tur
//               och ordning (två vid dubbelstämpel). popIndex/popDelay = en enda.
//   exits     — [{ index, delay }]: fyllda stämplar som lyfter och försvinner när
//               kortet börjar om efter inlösen (den tomma rutan blir kvar).
//   glowIndex — den sista tomma rutan när bara en stämpel är kvar: lyser och pulserar.
export default function StampRow({ total, filled, tone, size = 28, gap = 8, popIndex = -1, popDelay = 250, pops, exits, glowIndex = -1 }) {
  const n = Math.max(0, total | 0);
  const list = pops || (popIndex >= 0 ? [{ index: popIndex, delay: popDelay }] : []);
  const popAt = new Map(list.map((p) => [p.index, p.delay]));
  const exitAt = new Map((exits || []).map((e) => [e.index, e.delay]));
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap }}>
      {Array.from({ length: n }).map((_, i) => (
        <Stamp key={i} on={i < filled} tone={tone} size={size}
          pop={popAt.has(i)} popDelay={popAt.get(i) || 0}
          exit={exitAt.has(i)} exitDelay={exitAt.get(i) || 0}
          glow={i === glowIndex && i >= filled} />
      ))}
    </View>
  );
}

function Stamp({ on, tone, size, pop, popDelay, exit, exitDelay, glow }) {
  const p = useRef(new Animated.Value(pop ? 0 : 1)).current;
  const g = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!pop) return;
    p.setValue(0);
    const a = Animated.spring(p, { toValue: 1, friction: 4, tension: 90, delay: popDelay, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [pop, popDelay]);

  useEffect(() => {
    if (!exit) return;
    p.setValue(1);
    const a = Animated.timing(p, { toValue: 0, duration: 300, delay: exitDelay, easing: Easing.in(Easing.quad), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [exit, exitDelay]);

  useEffect(() => {
    if (!glow) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(g, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(g, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [glow]);

  const empty = (
    <Shape kind="cookie9" size={size} color={tone.deco}>
      {glow && <Gift size={Math.round(size * 0.5)} color={tone.primary} strokeWidth={2.4} />}
    </Shape>
  );
  const full = (
    <Shape kind="cookie9" size={size} color={tone.primary}>
      <Check size={Math.round(size * 0.5)} color="#FFFFFF" strokeWidth={3.5} />
    </Shape>
  );

  if (glow) {
    const halo = Math.round(size * 1.6);
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Animated.View style={{
          position: "absolute", left: -(halo - size) / 2, top: -(halo - size) / 2,
          opacity: g.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.95] }),
          transform: [{ scale: g.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.08] }) }],
        }}>
          <Shape kind="sunny8" size={halo} color={T.lime} />
        </Animated.View>
        {empty}
      </View>
    );
  }

  // Kortet börjar om: den fyllda stämpeln lyfter, snurrar och tonar bort från rutan.
  if (exit) {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <View style={{ position: "absolute" }}>{empty}</View>
        <Animated.View style={{
          opacity: p.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] }),
          transform: [
            { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [-Math.round(size * 0.6), 0] }) },
            { rotate: p.interpolate({ inputRange: [0, 1], outputRange: ["35deg", "0deg"] }) },
            { scale: p.interpolate({ inputRange: [0, 0.65, 1], outputRange: [0.3, 1.22, 1] }) },
          ],
        }}>{full}</Animated.View>
      </View>
    );
  }

  if (!pop) return on ? full : empty;

  // Ny stämpel: den tomma rutan syns först, sedan studsar den fyllda in med en sol bakom.
  const halo = Math.round(size * 1.4);
  return (
    <View style={{ width: halo, height: halo, alignItems: "center", justifyContent: "center", margin: -(halo - size) / 2 }}>
      <Animated.View style={{ position: "absolute", opacity: p.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }), transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }}>
        <Shape kind="sunny8" size={halo} color={tone.container} />
      </Animated.View>
      <View style={{ position: "absolute" }}>{empty}</View>
      <Animated.View style={{ transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }], opacity: p.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 1, 1] }) }}>{full}</Animated.View>
    </View>
  );
}

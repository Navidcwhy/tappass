import React, { useEffect, useState } from "react";
import { Animated, Easing, View, Dimensions } from "react-native";
import Shape from "./Shape";

const KINDS = ["cookie9", "sunny8", "clover4", "flower8", "pill"];
const STEPS = 48;      // nyckelrutor per bit — banan räknas ut i förväg
const G = 1500;        // tyngdkraft (px/s²)
const AIR = 2.2;       // luftmotstånd under kastet (1/s)
const DT = 1 / 120;
const MAX_T = 4.6;     // sekunder; bitar som inte fallit ut tonas bort
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// En bits bana med enkel fysik: kastet bromsas av luften, sedan vänder sig
// pappret platt och singlar ner i fallhastighet (vt) med sidosvaj, snurr och
// vändningar. Ger nyckelrutor som en enda Animated-timing spelar upp på
// native-tråden (ingen JS per bildruta).
function flight(x, y, vx, vy, vt, bottom) {
  const sway = rnd(10, 26), swayW = rnd(3.5, 6.5), ph = rnd(0, Math.PI * 2);
  const spin0 = rnd(-900, 900), spinF = rnd(-220, 220);
  const flipW = rnd(5, 10), ph2 = rnd(0, Math.PI * 2);
  let t = 0, rot = rnd(0, 360), fallT = 0;
  const raw = [{ t: 0, x, y, rot, flip: Math.cos(ph2) }];
  while (t < MAX_T && y < bottom) {
    const falling = vy > 0;
    if (falling) fallT += DT;
    vx -= vx * (falling ? 1.6 : AIR) * DT;
    vy += (G - (falling ? G / vt : AIR) * vy) * DT;
    x += vx * DT;
    y += vy * DT;
    rot += (spinF + (spin0 - spinF) * Math.exp(-1.8 * t)) * DT;
    t += DT;
    const sw = sway * Math.min(1, fallT / 0.6) * Math.sin(swayW * t + ph);
    const c = Math.cos(flipW * t + ph2);   // vändningen, aldrig helt osynlig på kanten
    raw.push({ t, x: x + sw, y, rot, flip: Math.sign(c) * (0.2 + 0.8 * Math.abs(c)) });
  }
  const end = raw[raw.length - 1].t;
  const xs = [], ys = [], rots = [], flips = [];
  for (let i = 0; i <= STEPS; i++) {
    const r = raw[Math.min(raw.length - 1, Math.round((end * i) / STEPS / DT))];
    xs.push(r.x);
    ys.push(r.y);
    rots.push(r.rot.toFixed(1) + "deg");
    flips.push(r.flip);
  }
  return { dur: Math.round(end * 1000), xs, ys, rots, flips };
}

const INPUT = Array.from({ length: STEPS + 1 }, (_, i) => i / STEPS);

function build(count, colors, from) {
  const { width: W, height: H } = Dimensions.get("window");
  const bottom = H + 40;
  const piece = (i, burst, delay, path) => ({
    p: new Animated.Value(0),
    kind: KINDS[i % KINDS.length],
    color: pick(colors),
    size: rnd(13, 24),
    burst,
    delay: Math.round(delay),
    ...path,
  });

  // Kast från en eller flera punkter: { x, y, count, angle (grader, -90 = upp), spread, speed: [min, max], delay }
  if (from && from.length) {
    const out = [];
    from.forEach((e) => {
      for (let i = 0; i < (e.count || 20); i++) {
        const a = ((e.angle ?? -90) + rnd(-(e.spread ?? 60), e.spread ?? 60)) * (Math.PI / 180);
        const v = rnd(e.speed ? e.speed[0] : 900, e.speed ? e.speed[1] : 1600);
        out.push(piece(out.length, true, (e.delay || 0) + rnd(0, 90),
          flight(e.x, e.y, Math.cos(a) * v, Math.sin(a) * v, rnd(230, 330), bottom)));
      }
    });
    return out;
  }

  // Regn uppifrån: bitarna faller redan och singlar ner över hela skärmen.
  return Array.from({ length: count }, (_, i) => {
    const vt = rnd(250, 360);
    return piece(i, false, rnd(0, 500), flight(rnd(0, W), rnd(-140, -20), rnd(-50, 50), vt * rnd(0.4, 1), vt, bottom));
  });
}

// Konfetti av appens mjuka former. Spelas en gång när komponenten monteras.
//   utan from — regn uppifrån över hela skärmen (count bitar)
//   from      — kast från punkter i skärmkoordinater, t.ex. ur en badge eller
//               två konfettikanoner i hörnen
export default function Confetti({ count = 26, colors = ["#56642B", "#CBDB98", "#FFFFFF", "#C9EE6B"], from }) {
  const [items] = useState(() => build(count, colors, from));

  useEffect(() => {
    const anims = items.map((it) => Animated.timing(it.p, { toValue: 1, duration: it.dur, delay: it.delay, easing: Easing.linear, useNativeDriver: true }));
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);

  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, overflow: "hidden" }}>
      {items.map((it, i) => {
        const s = Math.round(it.size);
        return (
          <Animated.View key={i} style={{
            position: "absolute", left: -s / 2, top: -s / 2,
            opacity: it.p.interpolate({ inputRange: [0, 0.015, 0.86, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateX: it.p.interpolate({ inputRange: INPUT, outputRange: it.xs }) },
              { translateY: it.p.interpolate({ inputRange: INPUT, outputRange: it.ys }) },
              { rotate: it.p.interpolate({ inputRange: INPUT, outputRange: it.rots }) },
              { scaleX: it.p.interpolate({ inputRange: INPUT, outputRange: it.flips }) },
              { scale: it.p.interpolate({ inputRange: [0, 0.05, 1], outputRange: [it.burst ? 0.35 : 1, 1, 1] }) },
            ],
          }}>
            {it.kind === "pill"
              ? <View style={{ width: Math.round(s * 0.45), height: Math.round(s * 1.25), borderRadius: s, backgroundColor: it.color }} />
              : <Shape kind={it.kind} size={s} color={it.color} />}
          </Animated.View>
        );
      })}
    </View>
  );
}

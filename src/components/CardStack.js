import React, { memo, useCallback, useMemo, useState } from "react";
import { Animated, View } from "react-native";
import LoyaltyCard from "./LoyaltyCard";
import useReduceMotion from "../lib/useReduceMotion";
import { quietNow } from "../lib/quiet";

// Kortbunten på hemskärmen. Korten får djup när listan skrollas:
//   in underifrån — kortet växer upp från 92 % och tonar fram när det kommer in i bild
//   ut överst     — kortet stannar kvar en bit, krymper och bleknar medan nästa kort
//                   glider över det, som i en bunt kort
// Kort med belöning får en glans som flyttar sig med skrollningen (holografisk).
// Allt drivs av huvudlistans skrollvärde på native-tråden; med "Reducera rörelse"
// står korten still.
//   scrollY — huvudlistans Animated-värde (contentOffset.y)
//   viewH   — huvudlistans synliga höjd
//   quietKey — ändras när någon butiks lugna timme börjar eller slutar (App)
// Förutsätter att hemfliken ligger överst i skrollinnehållet (listans y = innehållets y).
export default function CardStack({ cards, onOpenReward, scrollY, viewH, quietKey }) {
  const reduce = useReduceMotion();
  const [top, setTop] = useState(null);   // listans läge i skrollinnehållet
  const [rows, setRows] = useState({});   // slug → { y, h } inom listan

  const onRowLayout = useCallback((slug, e) => {
    const { y, height: h } = e.nativeEvent.layout;
    setRows((prev) => (prev[slug] && prev[slug].y === y && prev[slug].h === h ? prev : { ...prev, [slug]: { y, h } }));
  }, []);

  return (
    <View onLayout={(e) => setTop(e.nativeEvent.layout.y)} style={{ gap: 12, marginTop: 16 }}>
      {cards.map((c) => {
        const r = rows[c.slug];
        const live = !!(scrollY && viewH > 0 && top != null && r);
        return (
          <StackRow key={c.slug} card={c} onOpenReward={onOpenReward} onRowLayout={onRowLayout}
            scrollY={scrollY} viewH={viewH} reduce={reduce} quiet={quietKey ? quietNow(c.quietHours) : null}
            y0={live ? top + r.y : null} h={live ? r.h : 0} />
        );
      })}
    </View>
  );
}

// Ett kort i bunten. Memo: appen ritar om ofta (NFC-status, snackbar) och nya
// Animated-noder vid varje omritning skulle kopplas om på native-sidan i onödan.
const StackRow = memo(function StackRow({ card, onOpenReward, onRowLayout, scrollY, viewH, reduce, quiet, y0, h }) {
  const reward = !!card.pendingReward || card.stamps >= card.needed;
  const motion = useMemo(
    () => (y0 != null && !reduce ? depth(scrollY, y0, h, viewH) : null),
    [scrollY, y0, h, viewH, reduce]
  );
  const shine = useMemo(
    () => (y0 != null && !reduce && reward
      ? scrollY.interpolate({ inputRange: [y0 - viewH, y0 + Math.max(1, h)], outputRange: [-70, 70], extrapolate: "clamp" })
      : undefined),
    [scrollY, y0, h, viewH, reduce, reward]
  );
  return (
    <Animated.View onLayout={(e) => onRowLayout(card.slug, e)} style={motion}>
      <LoyaltyCard card={card} onOpenReward={onOpenReward} shineOffset={shine} stillShine={reduce} quiet={quiet} />
    </Animated.View>
  );
});

function depth(scrollY, y0, h, viewH) {
  const inA = y0 - viewH;                          // kortets överkant vid listans nederkant
  const inB = inA + Math.min(150, viewH * 0.25);   // helt framme
  const outA = Math.max(inB, y0);                  // överkanten når listans överkant
  const outB = outA + Math.max(1, h);              // kortet har passerat
  const range = [inA, inB, outA, outB];
  const at = (outputRange) => scrollY.interpolate({ inputRange: range, outputRange, extrapolate: "clamp" });
  return {
    opacity: at([0.55, 1, 1, 0.3]),
    transform: [
      { translateY: at([26, 0, 0, Math.round(h * 0.6)]) },
      { scale: at([0.92, 1, 1, 0.86]) },
    ],
  };
}

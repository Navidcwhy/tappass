import React, { useEffect, useRef } from "react";
import { View, Text, Animated, Easing, Pressable } from "react-native";
import { T, RADIUS, FONT } from "../lib/theme";
import { CafeIcon, Icon } from "../lib/icons";

function Stamp({ filled, biz, index, isNew }) {
  const scale = useRef(new Animated.Value(isNew ? 2 : 1)).current;
  const rot = useRef(new Animated.Value(isNew ? -10 : 0)).current;
  useEffect(() => {
    if (!isNew || !filled) return;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
      Animated.spring(rot, { toValue: 0, friction: 4, useNativeDriver: true }),
    ]).start();
  }, [isNew, filled]);

  if (!filled) {
    return (
      <View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: T.hairline, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: FONT.uiMed, fontSize: 12, color: T.inkFaint }}>{index + 1}</Text>
      </View>
    );
  }
  return (
    <Animated.View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: biz.ink, alignItems: "center", justifyContent: "center", transform: [{ scale }, { rotate: rot.interpolate({ inputRange: [-30, 30], outputRange: ["-30deg", "30deg"] }) }] }}>
      <CafeIcon symbol={biz.symbol} size={18} color="#fff" strokeWidth={1.8} />
    </Animated.View>
  );
}

export default function LoyaltyCard({ card, animateLast, onOpenReward }) {
  const c = card;
  const complete = c.stamps >= c.needed;
  const pending = c.pendingReward;
  const progress = Math.min(1, c.stamps / c.needed);

  return (
    <View style={{ backgroundColor: T.surface, borderRadius: RADIUS.lg, overflow: "hidden", borderWidth: 1, borderColor: pending ? c.ink : T.hairline, shadowColor: "#1A1612", shadowOpacity: 0.06, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 2 }}>
      <View style={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 18, flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.soft, alignItems: "center", justifyContent: "center" }}>
          <CafeIcon symbol={c.symbol} size={20} color={c.ink} strokeWidth={1.6} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONT.display, fontSize: 22, color: T.ink, lineHeight: 24 }}>{c.name}</Text>
          <Text style={{ fontFamily: FONT.ui, fontSize: 12.5, color: T.inkMute, marginTop: 2 }}>{c.type} · {c.area}</Text>
        </View>
        {!pending && <Text style={{ fontFamily: FONT.uiMed, fontSize: 12, color: c.ink, letterSpacing: 0.4 }}>{c.stamps}/{c.needed}</Text>}
      </View>

      {!pending && (
        <>
          <View style={{ height: 1.5, backgroundColor: T.hairline, marginHorizontal: 22 }}>
            <View style={{ height: 1.5, width: progress * 100 + "%", backgroundColor: c.ink }} />
          </View>

          <View style={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 20 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {Array.from({ length: c.needed }).map((_, i) => {
                const filled = i < c.stamps;
                const isNew = animateLast && i === c.stamps - 1;
                return <Stamp key={i} filled={filled} biz={c} index={i} isNew={isNew} />;
              })}
            </View>
          </View>
        </>
      )}

      {pending
        ? <PendingCTA card={c} onOpen={() => onOpenReward(c.id)} />
        : complete
          ? <RewardCTA card={c} onOpen={() => onOpenReward(c.id)} />
          : <View style={{ paddingHorizontal: 22, paddingBottom: 20, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: T.hairline, paddingTop: 16 }}>
              <Icon name="gift" size={16} color={T.inkMute} />
              <Text style={{ fontFamily: FONT.ui, fontSize: 13, color: T.inkSoft, flex: 1 }}>{c.reward}</Text>
              <Text style={{ fontFamily: FONT.uiMed, fontSize: 12, color: T.inkFaint }}>{c.needed - c.stamps} kvar</Text>
            </View>}
    </View>
  );
}

function RewardCTA({ card, onOpen }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])).start();
  }, []);
  return (
    <Pressable onPress={onOpen} style={{ backgroundColor: card.deep, paddingHorizontal: 22, paddingVertical: 18, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.accent, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.uiBold, fontSize: 11, color: T.accent, letterSpacing: 1.4 }}>BELÖNING KLAR</Text>
        <Text style={{ fontFamily: FONT.display, fontSize: 19, color: "#fff", marginTop: 2 }}>{card.reward}</Text>
      </View>
      <Icon name="chev" size={20} color="#fff" strokeWidth={2} />
    </Pressable>
  );
}

/* Pending reward state — full-card takeover, no stamp grid, urgent CTA */
function PendingCTA({ card, onOpen }) {
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start();
  }, []);

  return (
    <Pressable onPress={onOpen} style={{ backgroundColor: card.deep, padding: 24, alignItems: "center" }}>
      <Animated.View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: card.ink, alignItems: "center", justifyContent: "center", marginBottom: 16, transform: [{ translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }] }}>
        <Icon name="gift" size={28} color={T.accent} strokeWidth={1.8} />
      </Animated.View>
      <Text style={{ fontFamily: FONT.uiBold, fontSize: 10, color: T.accent, letterSpacing: 2 }}>SPARAD BELÖNING</Text>
      <Text style={{ fontFamily: FONT.display, fontSize: 24, color: "#fff", marginTop: 6, textAlign: "center", lineHeight: 28 }}>{card.reward}</Text>
      <Text style={{ fontFamily: FONT.ui, fontSize: 12.5, color: "rgba(255,255,255,.55)", marginTop: 6, textAlign: "center" }}>
        Tappar pausade hos {card.name} tills du löst in den.
      </Text>
      <View style={{ marginTop: 18, backgroundColor: T.accent, paddingHorizontal: 22, paddingVertical: 10, borderRadius: RADIUS.pill, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontFamily: FONT.uiBold, fontSize: 13, color: T.accentInk }}>Lös in</Text>
        <Icon name="chev" size={16} color={T.accentInk} strokeWidth={2.4} />
      </View>
    </Pressable>
  );
}

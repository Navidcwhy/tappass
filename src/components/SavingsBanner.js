import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Animated, Easing } from "react-native";
import * as Haptics from "expo-haptics";
import { T, FONT, tone as toneFor } from "../lib/theme";
import { Icon } from "../lib/icons";
import useReduceMotion from "../lib/useReduceMotion";
import { formatKr, rewardsText, placesText } from "../lib/savings";
import Shape from "./Shape";

const initialOf = (name) => (name || "?").trim().charAt(0).toUpperCase();

// Sparat-räknaren överst under Kort: "Du har fått 7 belöningar" och vad de var värda
// (värdet anger varje ställe). Tryck → per ställe.
// När summan ökar efter en inlösen räknar siffran upp och "+39 kr" stiger från den —
// men först när inget ark ligger över (hold), så att kunden ser det.
//   savings — walletSavings(korten)
//   synced  — första hämtningen från servern är klar: värdet då är utgångsläget och
//             räknas inte upp (annars skulle varje start "tjäna" hela summan)
// Renderas alltid (hooks behåller utgångsläget) men visar inget utan inlösta belöningar.
export default function SavingsBanner({ savings, hold = false, synced = true }) {
  const { rewards, kr, partial, places } = savings;
  const reduce = useReduceMotion();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(kr);    // talet som visas just nu
  const [gain, setGain] = useState(0);       // ökningen som stiger upp ("+39 kr")
  const base = useRef({ kr, rewards, armed: false });
  const count = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const b = base.current;
    // Utgångsläget: allt fram till första svaret från servern (cache, laddning).
    if (!b.armed) {
      b.kr = kr;
      b.rewards = rewards;
      b.armed = !!synced;
      setShown(kr);
      return;
    }
    if (hold) return;
    const from = b.kr;
    const more = rewards > b.rewards;
    b.kr = kr;
    b.rewards = rewards;
    if (kr <= from || reduce) {
      setShown(kr);
      if (more && !reduce) bounce(pop);
      return;
    }
    // Räkna upp från förra summan och låt ökningen stiga från siffran.
    setGain(kr - from);
    count.setValue(0);
    lift.setValue(0);
    const id = count.addListener(({ value }) => setShown(Math.round(from + (kr - from) * value)));
    Animated.parallel([
      Animated.timing(count, { toValue: 1, duration: 900, delay: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(lift, { toValue: 1, duration: 1700, delay: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => {
      count.removeListener(id);
      setShown(kr);
      setGain(0);
      if (finished) { bounce(pop); Haptics.selectionAsync(); }
    });
    return () => { count.removeListener(id); count.stopAnimation(); lift.stopAnimation(); };
  }, [kr, rewards, hold, synced, reduce]);

  if (!rewards) return null;

  const valued = kr > 0;
  const label = "Du har fått " + rewardsText(rewards) + " " + placesText(places)
    + (valued ? ", värda " + (partial ? "minst " : "") + kr + " kronor" : "")
    + (open ? ". Tryck för att dölja per ställe." : ". Tryck för att se per ställe.");

  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync(); setOpen((v) => !v); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => ({ marginTop: 14, borderRadius: 24, backgroundColor: T.surface, borderWidth: 1, borderColor: T.hairline, paddingVertical: 12, paddingLeft: 12, paddingRight: 16, opacity: pressed ? 0.9 : 1 })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Animated.View style={{ transform: [{ scale: pop }] }}>
          <Shape kind="sunny8" size={48} color={T.lime}>
            <Icon name="piggy" size={24} color={T.onPrimaryContainer} strokeWidth={2.2} />
          </Shape>
        </Animated.View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 16, lineHeight: 21, color: T.ink }}>Du har fått {rewardsText(rewards)}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: FONT.regular, fontSize: 14, lineHeight: 19, color: T.inkSoft }}>{placesText(places)}</Text>
            <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
              <Icon name="chevDown" size={16} color={T.inkSoft} />
            </View>
          </View>
        </View>
        {valued && (
          <View style={{ alignItems: "flex-end" }}>
            {/* Raden ovanför beloppet: "SPARAT" — medan summan räknar upp byts den mot ökningen ("+39 kr") */}
            <View style={{ height: 16, justifyContent: "flex-end", alignItems: "flex-end" }}>
              <Animated.Text style={{
                fontFamily: FONT.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.88, color: T.inkMute,
                // Byts i tur och ordning (inte genom varandra): ut → "+39 kr" in … ut → tillbaka
                opacity: gain > 0 ? lift.interpolate({ inputRange: [0, 0.06, 0.9, 0.97], outputRange: [1, 0, 0, 1], extrapolate: "clamp" }) : 1,
              }}>
                {partial ? "SPARAT MINST" : "SPARAT"}
              </Animated.Text>
              {gain > 0 && (
                <Animated.Text
                  importantForAccessibility="no"
                  style={{
                    position: "absolute", right: 0, bottom: -1,
                    fontFamily: FONT.bold, fontSize: 14, lineHeight: 17, color: T.primary,
                    opacity: lift.interpolate({ inputRange: [0, 0.06, 0.13, 0.82, 0.89], outputRange: [0, 0, 1, 1, 0], extrapolate: "clamp" }),
                    transform: [{ translateY: lift.interpolate({ inputRange: [0, 0.06, 0.16, 1], outputRange: [8, 8, 0, -3], extrapolate: "clamp" }) }],
                  }}
                >
                  {"+" + formatKr(gain)}
                </Animated.Text>
              )}
            </View>
            <Text style={{ fontFamily: FONT.display, fontSize: 24, lineHeight: 30, color: T.ink }}>{formatKr(shown)}</Text>
          </View>
        )}
      </View>

      {open && (
        <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: T.hairline, gap: 10 }}>
          {places.map((p) => {
            const t = toneFor(p.ink);
            return (
              <View key={p.slug} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Shape kind="cookie9" size={32} color={t.primary}>
                  <Text style={{ fontFamily: FONT.bold, fontSize: 13, color: "#FFFFFF" }}>{initialOf(p.name)}</Text>
                </Shape>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20, color: T.ink }}>{p.name}</Text>
                  <Text style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: T.inkSoft }}>{rewardsText(p.rewards)}</Text>
                </View>
                <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: p.kr > 0 ? T.ink : T.inkMute }}>
                  {p.kr > 0 ? (p.unvalued > 0 ? "minst " : "") + formatKr(p.kr) : "–"}
                </Text>
              </View>
            );
          })}
          <Text style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: T.inkMute }}>
            {"Värdet anges av varje ställe." + (partial || !valued ? " Ställen som inte angett något värde räknas inte in i summan." : "")}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function bounce(v) {
  v.setValue(1);
  Animated.sequence([
    Animated.timing(v, { toValue: 1.14, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    Animated.spring(v, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
  ]).start();
}

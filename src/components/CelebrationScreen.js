import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, Modal, Animated, Dimensions, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { T, FONT, tone as toneFor } from "../lib/theme";
import { Icon } from "../lib/icons";
import Shape from "./Shape";
import Confetti from "./Confetti";

const { width: W, height: H } = Dimensions.get("window");

// Stilla dekorformer (designkoordinater för en 390×844-skärm, skalas om).
const DECOR = [
  { kind: "sunny8", x: 22, y: 70, s: 70, rot: 10, c: "deco" },
  { kind: "sunny8", x: 176, y: 30, s: 30, c: "primary" },
  { kind: "cookie9", x: 304, y: 104, s: 40, c: "primary" },
  { kind: "clover4", x: 318, y: 236, s: 54, rot: 20, c: "bg" },
  { kind: "pill", x: 34, y: 262, w: 18, h: 46, rot: 32, c: "lime" },
  { kind: "flower8", x: 24, y: 560, s: 48, c: "bg" },
  { kind: "cookie9", x: 322, y: 570, s: 30, c: "primary" },
  { kind: "pill", x: 286, y: 630, w: 14, h: 36, rot: -28, c: "deco" },
  { kind: "cookie9", x: 120, y: 610, s: 20, c: "bg" },
  { kind: "pill", x: 196, y: 640, w: 12, h: 30, rot: 60, c: "primary" },
];

function Decor({ tone: t }) {
  const sx = W / 390, sy = H / 844;
  const color = { deco: t.deco, primary: t.primary, bg: T.bg, lime: T.lime };
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
      {DECOR.map((d, i) => d.kind === "pill" ? (
        <View key={i} style={{ position: "absolute", left: d.x * sx, top: d.y * sy, width: d.w, height: d.h, borderRadius: d.w / 2, backgroundColor: color[d.c], transform: [{ rotate: d.rot + "deg" }] }} />
      ) : (
        <Shape key={i} kind={d.kind} size={d.s} color={color[d.c]} rotate={d.rot || 0} style={{ position: "absolute", left: d.x * sx, top: d.y * sy }} />
      ))}
    </View>
  );
}

// Helskärm när en stämpelrad blir full: "Visa koden nu" eller "Spara till senare".
// Stängs den utan val ligger kortet kvar som "Belöning klar" på hemskärmen.
export default function CelebrationScreen({ visible, card, busy, onSave, onRedeemNow, onClose }) {
  const insets = useSafeAreaInsets();
  const pop = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) { pop.setValue(0); fade.setValue(0); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 45, useNativeDriver: true }).start();
    Animated.timing(fade, { toValue: 1, duration: 500, delay: 700, useNativeDriver: true }).start();
  }, [visible]);

  if (!visible || !card) return null;
  const t = toneFor(card.ink);
  const needed = Math.max(1, card.needed || 1);

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.container, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 16, alignItems: "center" }}>
        <Decor tone={t} />
        <Confetti count={26} colors={[t.primary, t.deco, "#FFFFFF", T.lime]} />

        <Pressable accessibilityLabel="Stäng" onPress={onClose} style={{ alignSelf: "flex-end", width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" }}>
          <Icon name="close" size={24} color={t.onContainer} />
        </Pressable>

        <View style={{ flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={{
            width: 260, height: 260, alignItems: "center", justifyContent: "center",
            transform: [{ scale: pop }, { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ["-25deg", "0deg"] }) }],
          }}>
            <Shape kind="burst12" size={260} color={t.primary} style={{ position: "absolute", left: 0, top: 0 }} />
            <Text style={{ fontFamily: FONT.display, fontSize: 72, lineHeight: 78, color: "#FFFFFF" }}>{needed}/{needed}</Text>
            <Text style={{ fontFamily: FONT.medium, fontSize: 15, color: "rgba(255,255,255,0.85)" }}>stämplar</Text>
          </Animated.View>

          <Text style={{ marginTop: 28, fontFamily: FONT.title, fontSize: 40, lineHeight: 48, color: t.onContainer, textAlign: "center" }}>Kortet är fullt!</Text>
          <View style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.6)" }}>
            <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: t.onContainer, textAlign: "center" }}>{card.reward}</Text>
          </View>
          <Text style={{ marginTop: 8, fontFamily: FONT.regular, fontSize: 15, color: t.muted }}>hos {card.name}</Text>
        </View>

        <Animated.View style={{ alignSelf: "stretch", opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
          <Pressable
            disabled={busy}
            accessibilityRole="button"
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); onRedeemNow(); }}
            style={({ pressed }) => ({ height: 56, borderRadius: 28, backgroundColor: t.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: busy ? 0.6 : pressed ? 0.88 : 1 })}
          >
            <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>Visa koden nu</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            accessibilityRole="button"
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSave(); }}
            style={({ pressed }) => ({ marginTop: 4, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
          >
            {busy
              ? <ActivityIndicator color={t.onContainer} />
              : <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: t.onContainer }}>Spara till senare</Text>}
          </Pressable>
          <Text style={{ marginTop: 4, fontFamily: FONT.regular, fontSize: 12, lineHeight: 17, color: t.muted, textAlign: "center" }}>
            Sparar du belöningen pausas stämpling hos {card.name} tills du löst in den.
          </Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

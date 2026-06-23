import React, { useEffect, useRef, useState } from "react";
import { View, Text, Modal, Pressable, Animated, Easing, Dimensions, PanResponder, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";
import { T, RADIUS, FONT } from "../lib/theme";
import { Icon, CafeIcon } from "../lib/icons";
import { saveReward, getCurrentSavedCode } from "../lib/supabase";
import Confetti from "./Confetti";

const { width: W } = Dimensions.get("window");

/* ──────────────────────────────────────────────────────────────
   Stage 1: Locked envelope. Slide-to-reveal.
   Stage 2: Code revealed. Customer shows it to staff.
            Staff types it on their merchant page → backend marks redeemed.
            App polls and updates automatically.
   ────────────────────────────────────────────────────────────── */

export default function RewardSheet({ visible, card, onClose, onRedeemed }) {
  const [stage, setStage] = useState("loading"); // loading | locked | revealed
  const [code, setCode] = useState(null);
  const pollRef = useRef(null);

// When opened: fetch existing saved code from backend (if any)
  useEffect(() => {
    if (!visible || !card) return;
    let alive = true;
    setStage("loading");
    (async () => {
      const existing = await getCurrentSavedCode(card.slug);
      if (!alive) return;
      if (existing) {
        setCode(existing);
        setStage("revealed");
      } else {
        setStage("locked");
      }
    })();
    return () => { alive = false; };
  }, [visible, card]);

  // Poll backend every 2 seconds when code is shown — to detect when staff redeems
  useEffect(() => {
    if (stage !== "revealed" || !card || !visible) return;
    let alive = true;
    let timer = null;

    const check = async () => {
      if (!alive) return;
      try {
        const c = await getCurrentSavedCode(card.slug);
        if (!alive) return;
        console.log("[TapPass] poll for", card.slug, "→ code:", c);
        if (!c) {
          // Code is gone → staff redeemed it
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          if (timer) clearInterval(timer);
          onRedeemed(card.slug);
        }
      } catch (e) {
        console.log("[TapPass] poll error:", e?.message);
      }
    };

    // First check immediately, then every 2 sec
    check();
    timer = setInterval(check, 2000);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [stage, card, visible, onRedeemed]);

  if (!visible || !card) return null;

  const handleReveal = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStage("loading");
    const result = await saveReward(card.slug);
    if (result.ok) {
      setCode(result.code);
      setStage("revealed");
    } else {
      setStage("locked");
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: card.deep }}>
        <Pressable onPress={onClose} style={{ position: "absolute", top: 60, right: 22, zIndex: 100, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.12)", alignItems: "center", justifyContent: "center" }}>
          <Icon name="close" size={20} color="#fff" strokeWidth={2} />
        </Pressable>

        {stage === "loading" && (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator size="large" color={T.accent} />
          </View>
        )}
        {stage === "locked" && <LockedStage card={card} onReveal={handleReveal} />}
        {stage === "revealed" && <RevealedStage card={card} code={code} />}
      </View>
    </Modal>
  );
}

/* ────────────── STAGE 1 — LOCKED ENVELOPE ────────────── */
function LockedStage({ card, onReveal }) {
  const dragX = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const TRACK = W - 60;
  const KNOB = 64;
  const MAX = TRACK - KNOB - 6;

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])).start();
  }, []);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); },
      onPanResponderMove: (_, g) => {
        const x = Math.max(0, Math.min(MAX, g.dx));
        dragX.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        const x = Math.max(0, Math.min(MAX, g.dx));
        if (x >= MAX * 0.85) {
          Animated.timing(dragX, { toValue: MAX, duration: 120, useNativeDriver: false }).start(() => onReveal());
        } else {
          Animated.spring(dragX, { toValue: 0, friction: 7, useNativeDriver: false }).start();
        }
      },
    })
  ).current;

  return (
    <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 120, alignItems: "center" }}>
      <Text style={{ fontFamily: FONT.uiBold, fontSize: 11, color: T.accent, letterSpacing: 2 }}>DU HAR LÅST UPP EN BELÖNING</Text>
      <Text style={{ fontFamily: FONT.display, fontSize: 44, color: "#fff", textAlign: "center", marginTop: 14, lineHeight: 46 }}>{card.reward}</Text>
      <Text style={{ fontFamily: FONT.ui, fontSize: 15, color: "rgba(255,255,255,.6)", marginTop: 8 }}>hos {card.name}</Text>

      <Animated.View style={{ marginTop: 60, transform: [{ translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -12] }) }] }}>
        <Envelope card={card} />
      </Animated.View>

      <View style={{ flex: 1 }} />

      <View style={{ width: TRACK, height: KNOB + 6, borderRadius: (KNOB + 6) / 2, backgroundColor: "rgba(255,255,255,.08)", borderWidth: 1, borderColor: "rgba(255,255,255,.14)", marginBottom: 50, justifyContent: "center", overflow: "hidden" }}>
        <Animated.View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: dragX.interpolate({ inputRange: [0, MAX], outputRange: [KNOB + 6, TRACK] }), backgroundColor: T.accent, opacity: dragX.interpolate({ inputRange: [0, MAX], outputRange: [0.2, 0.7] }) }} />
        <Animated.Text style={{ fontFamily: FONT.uiMed, fontSize: 14, color: "#fff", textAlign: "center", letterSpacing: 0.5, opacity: dragX.interpolate({ inputRange: [0, MAX * 0.6], outputRange: [0.85, 0] }) }}>
          Dra för att öppna ›››
        </Animated.Text>
        <Animated.View {...responder.panHandlers} style={{ position: "absolute", left: 3, top: 3, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: T.accent, alignItems: "center", justifyContent: "center", transform: [{ translateX: dragX }], shadowColor: T.accent, shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 8 }}>
          <Icon name="arrowOut" size={26} color={T.accentInk} strokeWidth={2.4} />
        </Animated.View>
      </View>
    </View>
  );
}

function Envelope({ card }) {
  return (
    <View style={{ width: 230, height: 150, borderRadius: 14, backgroundColor: T.accent, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 10 }}>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 75, borderTopLeftRadius: 14, borderTopRightRadius: 14, backgroundColor: T.accentDark, transform: [{ skewY: "-8deg" }, { translateY: -8 }], opacity: 0.85 }} />
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: card.deep, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: T.accent }}>
        <Icon name="gift" size={22} color={T.accent} strokeWidth={1.8} />
      </View>
    </View>
  );
}

/* ────────────── STAGE 2 — REVEALED CODE ────────────── */
function RevealedStage({ card, code }) {
  const slide = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: 1, friction: 7, tension: 50, useNativeDriver: true }).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start();
  }, []);

  // Format code as "482 · 917" for readability
  const displayCode = code ? code.slice(0, 3) + "  " + code.slice(3) : "······";

  return (
    <View style={{ flex: 1, paddingHorizontal: 22, paddingTop: 80, justifyContent: "space-between" }}>
      <View style={{ alignItems: "center" }}>
        <Text style={{ fontFamily: FONT.uiBold, fontSize: 11, color: T.accent, letterSpacing: 2 }}>VISA FÖR PERSONALEN</Text>
        <Text style={{ fontFamily: FONT.display, fontSize: 26, color: "#fff", marginTop: 6 }}>Din belöningskod</Text>
      </View>

      <Animated.View style={{
        transform: [
          { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) },
          { scale: slide.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
        ],
        opacity: slide,
      }}>
        <View style={{ backgroundColor: T.bg, borderRadius: RADIUS.lg, padding: 28, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 30, shadowOffset: { width: 0, height: 14 }, elevation: 14 }}>
          <View style={{ position: "absolute", left: -8, top: 78, width: 16, height: 16, borderRadius: 8, backgroundColor: card.deep }} />
          <View style={{ position: "absolute", right: -8, top: 78, width: 16, height: 16, borderRadius: 8, backgroundColor: card.deep }} />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: card.soft, alignItems: "center", justifyContent: "center" }}>
              <CafeIcon symbol={card.symbol} size={20} color={card.ink} strokeWidth={1.6} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FONT.uiMed, fontSize: 12, color: T.inkMute, letterSpacing: 1 }}>{card.name.toUpperCase()}</Text>
              <Text style={{ fontFamily: FONT.ui, fontSize: 12, color: T.inkFaint, marginTop: 1 }}>{card.reward}</Text>
            </View>
          </View>

          {/* The big code */}
          <View style={{ marginTop: 36, alignItems: "center", paddingTop: 28, paddingBottom: 24, borderTopWidth: 1, borderTopColor: T.hairline, borderStyle: "dashed", borderBottomWidth: 1, borderBottomColor: T.hairline }}>
            <Text style={{ fontFamily: FONT.uiBold, fontSize: 10, color: T.inkMute, letterSpacing: 1.8 }}>SÄG ELLER VISA DENNA KOD</Text>
            <Animated.Text style={{
              fontFamily: FONT.mono,
              fontSize: 54,
              color: T.ink,
              letterSpacing: 6,
              marginTop: 12,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }),
            }}>{displayCode}</Animated.Text>
          </View>

          <View style={{ marginTop: 22, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <ActivityIndicator size="small" color={T.inkMute} />
            <Text style={{ fontFamily: FONT.ui, fontSize: 12, color: T.inkMute, flex: 1 }}>
              Väntar på att personalen ska bekräfta…
            </Text>
          </View>
        </View>
      </Animated.View>

      <View style={{ marginBottom: 40, alignItems: "center" }}>
        <Text style={{ fontFamily: FONT.ui, fontSize: 13, color: "rgba(255,255,255,.55)", textAlign: "center", lineHeight: 19, maxWidth: 280 }}>
          Personalen skriver in koden i sin TapPass-panel. Skärmen uppdateras automatiskt när det är klart.
        </Text>
      </View>
    </View>
  );
}

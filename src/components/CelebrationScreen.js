import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, Modal, Animated, Easing, Dimensions } from "react-native";
import * as Haptics from "expo-haptics";
import { T, RADIUS, FONT } from "../lib/theme";
import { Icon, CafeIcon } from "../lib/icons";
import Confetti from "./Confetti";

const { width: W, height: H } = Dimensions.get("window");

// Random congratulatory phrase per reward — feels human, not template
const PHRASES = [
  "Du gjorde det.",
  "Belöning upplåst!",
  "Snyggt jobbat.",
  "Sista stämpeln.",
  "Det är nu.",
];

/* Floating word — gentle sinus wobble on Y + tiny rotation */
function FloatWord({ text, delay = 0, size = 56, italic = false }) {
  const y = useRef(new Animated.Value(0)).current;
  const r = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 700, delay, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
    const loop = () => {
      Animated.sequence([
        Animated.parallel([
          Animated.timing(y, { toValue: -6, duration: 2200, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(r, { toValue: 1.2, duration: 2200, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        ]),
        Animated.parallel([
          Animated.timing(y, { toValue: 6, duration: 2400, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(r, { toValue: -1.2, duration: 2400, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        ]),
      ]).start(loop);
    };
    setTimeout(loop, delay);
  }, []);

  return (
    <Animated.Text style={{
      fontFamily: italic ? FONT.displayItalic : FONT.display,
      fontSize: size,
      color: "#fff",
      lineHeight: size * 1.05,
      textAlign: "center",
      opacity: fade,
      transform: [
        { translateY: y },
        { rotate: r.interpolate({ inputRange: [-5, 5], outputRange: ["-1.4deg", "1.4deg"] }) },
      ],
    }}>{text}</Animated.Text>
  );
}

/* Big reward icon in middle — slow pulse + slight rotation */
function FloatingIcon({ symbol, color, bg }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const rot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(rot, { toValue: 1, duration: 6000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(rot, { toValue: -1, duration: 6000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start();
  }, []);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const rotate = rot.interpolate({ inputRange: [-1, 1], outputRange: ["-4deg", "4deg"] });
  const ringPulse = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] });
  const ringFade = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] });

  return (
    <View style={{ alignItems: "center", justifyContent: "center", marginVertical: 36 }}>
      {/* Pulsing rings */}
      <Animated.View style={{ position: "absolute", width: 200, height: 200, borderRadius: 100, borderWidth: 1.5, borderColor: color, opacity: ringFade, transform: [{ scale: ringPulse }] }} />
      <Animated.View style={{ position: "absolute", width: 200, height: 200, borderRadius: 100, borderWidth: 1, borderColor: color, opacity: 0.15 }} />
      {/* Central icon */}
      <Animated.View style={{ width: 160, height: 160, borderRadius: 80, backgroundColor: bg, alignItems: "center", justifyContent: "center", transform: [{ scale }, { rotate }], shadowColor: color, shadowOpacity: 0.7, shadowRadius: 40, shadowOffset: { width: 0, height: 0 }, elevation: 16 }}>
        <CafeIcon symbol={symbol} size={80} color={color} strokeWidth={1.3} />
      </Animated.View>
    </View>
  );
}

export default function CelebrationScreen({ visible, card, onSave, onRedeemNow }) {
  const phrase = useRef(PHRASES[Math.floor(Math.random() * PHRASES.length)]).current;
  const fade = useRef(new Animated.Value(0)).current;
  const buttonsFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) { fade.setValue(0); buttonsFade.setValue(0); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.timing(fade, { toValue: 1, duration: 800, useNativeDriver: true }).start();
    Animated.timing(buttonsFade, { toValue: 1, duration: 600, delay: 1400, useNativeDriver: true }).start();
  }, [visible]);

  if (!visible || !card) return null;

  return (
    <Modal visible animationType="fade" transparent={false}>
      <Animated.View style={{ flex: 1, backgroundColor: card.deep, opacity: fade }}>
        {/* Confetti shower */}
        <Confetti count={50} />

        {/* Soft accent glow at center */}
        <View pointerEvents="none" style={{ position: "absolute", top: H * 0.25, left: W / 2 - 200, width: 400, height: 400, borderRadius: 200, backgroundColor: card.ink, opacity: 0.25 }} />

        <View style={{ flex: 1, paddingHorizontal: 28, paddingTop: 100, paddingBottom: 40, justifyContent: "space-between" }}>
          {/* Top: phrase */}
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontFamily: FONT.uiBold, fontSize: 11, color: T.accent, letterSpacing: 2 }}>{card.name.toUpperCase()}</Text>
            <View style={{ marginTop: 18 }}>
              <FloatWord text={phrase} size={48} delay={0} />
            </View>
          </View>

          {/* Middle: icon + reward */}
          <View style={{ alignItems: "center" }}>
            <FloatingIcon symbol={card.symbol} color={T.accent} bg={card.ink} />
            <View style={{ marginTop: 8, alignItems: "center" }}>
              <Text style={{ fontFamily: FONT.uiMed, fontSize: 11, color: "rgba(255,255,255,.55)", letterSpacing: 1.8 }}>DIN BELÖNING</Text>
              <View style={{ marginTop: 10 }}>
                <FloatWord text={card.reward} size={32} italic delay={300} />
              </View>
            </View>
          </View>

          {/* Bottom: two CTAs */}
          <Animated.View style={{ opacity: buttonsFade, transform: [{ translateY: buttonsFade.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); onRedeemNow(); }} style={({ pressed }) => ({ backgroundColor: T.accent, paddingVertical: 18, borderRadius: RADIUS.pill, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: pressed ? 0.85 : 1, shadowColor: T.accent, shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 10 })}>
              <Icon name="gift" size={20} color={T.accentInk} strokeWidth={2.2} />
              <Text style={{ fontFamily: FONT.uiBold, fontSize: 15, color: T.accentInk, letterSpacing: 0.3 }}>Lös in nu</Text>
            </Pressable>

            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSave(); }} style={({ pressed }) => ({ marginTop: 12, backgroundColor: "transparent", paddingVertical: 18, borderRadius: RADIUS.pill, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: pressed ? 0.7 : 1, borderWidth: 1, borderColor: "rgba(255,255,255,.25)" })}>
              <Text style={{ fontFamily: FONT.uiMed, fontSize: 15, color: "#fff", letterSpacing: 0.3 }}>Spara belöning till senare</Text>
            </Pressable>

            <Text style={{ fontFamily: FONT.ui, fontSize: 12, color: "rgba(255,255,255,.4)", textAlign: "center", marginTop: 14, lineHeight: 18 }}>
              Sparar du belöningen pausas stämpling på{"\n"}{card.name} tills du löst in den.
            </Text>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

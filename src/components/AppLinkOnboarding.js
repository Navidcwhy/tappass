import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Modal, ScrollView, Animated, Easing, Linking } from "react-native";
import * as Haptics from "expo-haptics";
import { T, RADIUS, FONT } from "../lib/theme";
import { Icon } from "../lib/icons";

const STEPS = [
  {
    label: "STEG 1 / 4",
    title: "En sista sak innan magin funkar.",
    body: "För att TapPass ska öppnas automatiskt när du tappar en NFC-tagg behöver du säga åt Android att appen får hantera länkar från tappass.se. Det tar 30 sekunder.",
    cta: "Visa hur",
    icon: "sparkles",
  },
  {
    label: "STEG 2 / 4",
    title: "Öppna Inställningar för TapPass.",
    body: "Tryck på knappen nedan. Du tas direkt till TapPass app-inställningar. Leta efter raden \"Öppna som standard\".",
    cta: "Öppna app-inställningar",
    icon: "arrowOut",
    action: "open-settings",
  },
  {
    label: "STEG 3 / 4",
    title: "Lägg till tappass.se och www.tappass.se.",
    body: "Inne i \"Öppna som standard\" trycker du på \"Lägg till länk\" (eller \"Add link\"). Bocka i både tappass.se och www.tappass.se. Klart.",
    cta: "Jag har bockat i båda",
    icon: "check",
  },
  {
    label: "STEG 4 / 4",
    title: "Du är redo.",
    body: "Tappa en TapPass-platta — appen öppnas och stämpeln registreras direkt. Funkar även när telefonen är låst.",
    cta: "Kom igång",
    icon: "scan",
  },
];

export default function AppLinkOnboarding({ visible, onClose }) {
  const [step, setStep] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) { setStep(0); slide.setValue(0); }
  }, [visible]);

  useEffect(() => {
    Animated.spring(slide, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }).start();
    return () => slide.setValue(0);
  }, [step]);

  if (!visible) return null;
  const s = STEPS[step];

  const next = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (s.action === "open-settings") {
      Linking.openSettings().catch(() => {});
    }
    if (step < STEPS.length - 1) setStep(step + 1);
    else { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onClose(); }
  };

  return (
    <Modal visible animationType="fade" transparent>
      <View style={{ flex: 1, backgroundColor: T.ink }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 30, paddingTop: 80, paddingBottom: 40, justifyContent: "space-between" }}>
          {/* Progress dots */}
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 30 }}>
            {STEPS.map((_, i) => (
              <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= step ? T.accent : "rgba(255,255,255,.15)" }} />
            ))}
          </View>

          <Animated.View style={{ flex: 1, opacity: slide, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
            <Text style={{ fontFamily: FONT.uiBold, fontSize: 11, color: T.accent, letterSpacing: 2 }}>{s.label}</Text>

            {/* Icon badge */}
            <View style={{ marginTop: 36, width: 84, height: 84, borderRadius: 42, backgroundColor: "rgba(184,214,53,.12)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(184,214,53,.3)" }}>
              <Icon name={s.icon} size={38} color={T.accent} strokeWidth={1.6} />
            </View>

            <Text style={{ fontFamily: FONT.display, fontSize: 36, color: "#fff", lineHeight: 40, marginTop: 28 }}>{s.title}</Text>
            <Text style={{ fontFamily: FONT.ui, fontSize: 16, color: "rgba(255,255,255,.65)", marginTop: 18, lineHeight: 24 }}>{s.body}</Text>
          </Animated.View>

          <Pressable onPress={next} style={({ pressed }) => ({ marginTop: 30, backgroundColor: T.accent, paddingVertical: 18, borderRadius: RADIUS.pill, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: pressed ? 0.85 : 1 })}>
            <Text style={{ fontFamily: FONT.uiBold, fontSize: 15, color: T.accentInk, letterSpacing: 0.3 }}>{s.cta}</Text>
            <Icon name="chev" size={20} color={T.accentInk} strokeWidth={2.4} />
          </Pressable>

          {step < STEPS.length - 1 && (
            <Pressable onPress={onClose} style={{ marginTop: 14, alignSelf: "center" }}>
              <Text style={{ fontFamily: FONT.uiMed, fontSize: 13, color: "rgba(255,255,255,.4)" }}>Hoppa över</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

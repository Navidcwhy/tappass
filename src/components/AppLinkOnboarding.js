import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Modal, ScrollView, Animated, Linking, Platform, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { T, FONT } from "../lib/theme";
import { Icon } from "../lib/icons";
import Shape from "./Shape";
import BrandMark from "./BrandMark";

const { width: W } = Dimensions.get("window");

// Efter välkomstsidan: Android behöver att appen får öppna tappass.se-länkar
// ("Öppna som standard") för att en tagg ska öppna appen direkt. iOS saknar den
// inställningen — där förklaras Skanna-knappen.
const ANDROID_STEPS = [
  {
    title: "Låt TapPass öppna stämplarna",
    body: "När du tappar en stämpel öppnas en länk till tappass.se. Säg åt Android att TapPass får öppna de länkarna, så registreras stämpeln direkt. Tryck på knappen och leta upp raden ”Öppna som standard”.",
    cta: "Öppna app-inställningar",
    icon: "link",
    shape: "sunny8",
    action: "open-settings",
  },
  {
    title: "Lägg till tappass.se",
    body: "Inne i ”Öppna som standard” trycker du på ”Lägg till länk” och bockar i både tappass.se och www.tappass.se.",
    cta: "Jag har bockat i båda",
    icon: "check",
    shape: "cookie12",
  },
  {
    title: "Du är redo",
    body: "Tappa en TapPass-stämpel i kassan – appen öppnas och stämpeln registreras direkt.",
    cta: "Börja samla",
    icon: "nfc",
    shape: "flower8",
  },
];

const IOS_STEPS = [
  {
    title: "Tryck på Skanna och håll mot stämpeln",
    body: "Tryck på ”Skanna stämpel” och håll toppen av iPhonen mot TapPass-stämpeln i kassan. Håll kvar tills iOS bekräftar.",
    cta: "Uppfattat",
    icon: "scan",
    shape: "sunny8",
  },
  {
    title: "Du är redo",
    body: "Har butiken en länkad stämpel räcker det ofta att hålla telefonen mot den för att öppna appen direkt. Annars använder du Skanna-knappen.",
    cta: "Börja samla",
    icon: "nfc",
    shape: "flower8",
  },
];

const STEPS = Platform.OS === "ios" ? IOS_STEPS : ANDROID_STEPS;
const TOTAL = STEPS.length + 1;   // + välkomstsidan

export default function AppLinkOnboarding({ visible, onClose }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) setStep(0);
  }, [visible]);

  // Körs även när modalen öppnas (inte bara vid stegbyte) — annars startar
  // intoningen aldrig för första sidan och innehållet fastnar på opacity 0.
  useEffect(() => {
    if (!visible) return;
    slide.setValue(0);
    Animated.spring(slide, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }).start();
  }, [step, visible]);

  if (!visible) return null;
  const s = step > 0 ? STEPS[step - 1] : null;
  const last = step === TOTAL - 1;

  const next = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (s && s.action === "open-settings") Linking.openSettings().catch(() => {});
    if (!last) setStep(step + 1);
    else { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onClose(); }
  };

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: T.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          <Animated.View style={{ flex: 1, opacity: slide, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
            {step === 0 ? <Welcome /> : <StepPage s={s} index={step} />}
          </Animated.View>
        </ScrollView>

        <View style={{ paddingHorizontal: 24, paddingBottom: 16 }}>
          <Pressable
            onPress={next}
            accessibilityRole="button"
            style={({ pressed }) => ({ height: 56, borderRadius: 28, backgroundColor: T.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}
          >
            <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: T.onPrimary }}>{step === 0 ? "Kom igång" : s.cta}</Text>
          </Pressable>
          {!last && (
            <Pressable onPress={onClose} accessibilityRole="button" style={{ marginTop: 4, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: T.inkSoft }}>Hoppa över</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Welcome() {
  return (
    <View>
      <WelcomeArt />
      <View style={{ paddingHorizontal: 24, paddingTop: 8 }}>
        <Text style={{ fontFamily: FONT.title, fontSize: 36, lineHeight: 43, color: T.ink }}>Stämpelkortet som bor i telefonen</Text>
        <Text style={{ marginTop: 10, fontFamily: FONT.regular, fontSize: 16, lineHeight: 24, color: T.inkSoft }}>
          Tappa telefonen mot TapPass-stämpeln i kassan. Inget konto, ingen inloggning.
        </Text>
        <View style={{ marginTop: 20, flexDirection: "row", gap: 8 }}>
          {["Tappa i kassan", "Samla stämplar", "Få belöningen"].map((label, i) => (
            <View key={label} style={{ flex: 1, gap: 6 }}>
              <Shape kind="cookie9" size={28} color={T.primary}>
                <Text style={{ fontFamily: FONT.bold, fontSize: 13, color: T.onPrimary }}>{i + 1}</Text>
              </Shape>
              <Text style={{ fontFamily: FONT.semibold, fontSize: 13, lineHeight: 17, color: T.ink }}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function StepPage({ s, index }) {
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 24 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {Array.from({ length: TOTAL }).map((_, i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= index ? T.primary : T.container }} />
        ))}
      </View>
      <Shape kind={s.shape} size={140} color={T.primaryContainer} style={{ marginTop: 40 }}>
        <Icon name={s.icon} size={52} color={T.onPrimaryContainer} strokeWidth={1.8} />
      </Shape>
      <Text style={{ marginTop: 28, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.96, color: T.primary }}>STEG {index + 1} AV {TOTAL}</Text>
      <Text style={{ marginTop: 6, fontFamily: FONT.title, fontSize: 32, lineHeight: 39, color: T.ink }}>{s.title}</Text>
      <Text style={{ marginTop: 12, fontFamily: FONT.regular, fontSize: 16, lineHeight: 24, color: T.inkSoft }}>{s.body}</Text>
    </View>
  );
}

// Illustration: telefon som tappas mot TapPass-stämpeln, med stämplar som flyger ut.
// Ritad i en 390×330-ruta och skalad till skärmbredden.
function WelcomeArt() {
  const s = Math.min(1, W / 390);
  const done = (size, color) => (
    <Shape kind="cookie9" size={size} color={color}>
      <Icon name="check" size={Math.round(size * 0.47)} color="#FFFFFF" strokeWidth={3.5} />
    </Shape>
  );
  const mini = (color, n) => Array.from({ length: 6 }).map((_, i) => (
    <Shape key={i} kind="cookie9" size={14} color={i < n ? color[0] : color[1]} />
  ));

  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 390 * s, height: 330 * s, alignSelf: "center" }}>
      <View style={{ position: "absolute", width: 390, height: 330, left: -(390 * (1 - s)) / 2, top: -(330 * (1 - s)) / 2, transform: [{ scale: s }] }}>
        <Shape kind="flower8" size={280} color={T.primaryContainer} style={{ position: "absolute", left: 55, top: 34 }} />
        <Shape kind="sunny8" size={96} color="#D3E8EC" style={{ position: "absolute", left: 278, top: 20 }} />
        <Shape kind="clover4" size={76} color={T.tertiaryContainer} style={{ position: "absolute", left: 20, top: 214 }} />

        <View style={{ position: "absolute", left: 118, top: 46, width: 132, height: 236, padding: 6, borderRadius: 28, backgroundColor: T.ink, transform: [{ rotate: "-8deg" }], shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 12 }, elevation: 8 }}>
          <View style={{ flex: 1, paddingTop: 16, paddingHorizontal: 10, borderRadius: 22, backgroundColor: T.bg, gap: 8 }}>
            <View style={{ width: 58, height: 9, borderRadius: 5, backgroundColor: T.ink }} />
            <View style={{ marginTop: 6, padding: 10, borderRadius: 14, backgroundColor: "#DCE8B4", gap: 8 }}>
              <View style={{ width: 64, height: 7, borderRadius: 4, backgroundColor: "#56642B" }} />
              <View style={{ flexDirection: "row", gap: 4 }}>{mini(["#56642B", "#CBDB98"], 4)}</View>
              <View style={{ height: 18, borderRadius: 9, backgroundColor: "#56642B" }} />
            </View>
            <View style={{ padding: 10, borderRadius: 14, backgroundColor: "#D3E8EC", gap: 8 }}>
              <View style={{ width: 44, height: 7, borderRadius: 4, backgroundColor: "#1B6371" }} />
              <View style={{ flexDirection: "row", gap: 4 }}>{mini(["#1B6371", "#B3D3D9"], 3)}</View>
            </View>
          </View>
        </View>

        <Svg width={390} height={330} viewBox="0 0 390 330" style={{ position: "absolute", left: 0, top: 0 }}>
          <Path d="M264.4 228.3A10 10 0 0 1 264.4 243.7" stroke={T.primary} strokeWidth={3} strokeLinecap="round" fill="none" />
          <Path d="M269.6 222.2A18 18 0 0 1 269.6 249.8" stroke={T.primary} strokeWidth={3} strokeLinecap="round" fill="none" />
          <Path d="M274.7 216.1A26 26 0 0 1 274.7 255.9" stroke={T.primary} strokeWidth={3} strokeLinecap="round" fill="none" />
        </Svg>

        <View style={{ position: "absolute", left: 290, top: 196, width: 80, height: 80, borderRadius: 40, backgroundColor: T.ink, borderWidth: 4, borderColor: T.lime, alignItems: "center", justifyContent: "center", gap: 2, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}>
          <BrandMark size={26} arcColor={T.lime} dotColor={T.lime} />
          <Text style={{ fontFamily: FONT.bold, fontSize: 11, color: T.lime }}>TapPass</Text>
        </View>

        <View style={{ position: "absolute", left: 52, top: 110 }}>{done(34, "#56642B")}</View>
        <View style={{ position: "absolute", left: 300, top: 130 }}>{done(28, "#1B6371")}</View>
        <Shape kind="cookie9" size={22} color={T.primary} style={{ position: "absolute", left: 96, top: 34 }} />
      </View>
    </View>
  );
}

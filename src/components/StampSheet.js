import React, { useEffect, useRef } from "react";
import { View, Text, Modal, Pressable, Animated } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { T, FONT, tone as toneFor } from "../lib/theme";
import Shape from "./Shape";
import StampRow from "./StampRow";

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "");

// Arket som kommer upp efter en lyckad tap: "+1" (eller "+2" med dubbelstämpel
// från Dagens hjul), var kortet står och den nya stämpeln som studsar in.
// Stängs av App efter några sekunder.
export default function StampSheet({ card, onClose }) {
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!card) return;
    rise.setValue(0);
    pop.setValue(0);
    Animated.spring(rise, { toValue: 1, friction: 9, tension: 70, useNativeDriver: true }).start();
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 80, delay: 150, useNativeDriver: true }).start();
  }, [card]);

  if (!card) return null;
  const t = toneFor(card.ink);
  const needed = Math.max(1, card.needed || 1);
  const stamps = Math.max(0, Math.min(card.stamps || 0, needed));
  const left = needed - stamps;
  const leftText = left === 1 ? "en kvar" : left + " kvar";
  const added = card.added === 2 ? 2 : 1;   // 2 = dubbelstämpel från Dagens hjul

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityLabel="Stäng" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: T.scrim }} />
        <Animated.View style={{
          backgroundColor: T.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
          paddingHorizontal: 24, paddingTop: 10, paddingBottom: 28 + insets.bottom, alignItems: "center",
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [480, 0] }) }],
        }}>
          <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: T.outline }} />

          <View style={{ width: 170, height: 150, marginTop: 18 }}>
            <Shape kind="sunny8" size={30} color={t.container} style={{ position: "absolute", left: 0, top: 12 }} />
            <Shape kind="cookie9" size={22} color={t.deco} style={{ position: "absolute", right: 4, top: 4 }} />
            <Shape kind="cookie9" size={16} color={t.primary} style={{ position: "absolute", right: 10, bottom: 6 }} />
            <Animated.View style={{ position: "absolute", left: 19, top: 9, transform: [{ scale: pop }, { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ["-30deg", "0deg"] }) }] }}>
              <Shape kind="burst12" size={132} color={t.primary}>
                <Text style={{ fontFamily: FONT.display, fontSize: 46, color: "#FFFFFF" }}>+{added}</Text>
              </Shape>
            </Animated.View>
          </View>

          <Text style={{ marginTop: 14, fontFamily: FONT.title, fontSize: 24, lineHeight: 32, color: T.ink, textAlign: "center" }}>
            {added === 2 ? "Dubbelstämpel hos " : "Stämpel hos "}{card.name}
          </Text>
          <Text style={{ marginTop: 4, fontFamily: FONT.regular, fontSize: 16, lineHeight: 24, color: T.inkSoft, textAlign: "center" }}>
            {stamps} av {needed} – {leftText} till {lowerFirst(card.rewardShort || card.reward)}.
          </Text>

          <View style={{ marginTop: 18 }}>
            <StampRow total={needed} filled={stamps} tone={t} size={30} popIndex={stamps - 1} />
          </View>

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => ({ marginTop: 24, alignSelf: "stretch", height: 56, borderRadius: 28, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}
          >
            <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>Klart</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

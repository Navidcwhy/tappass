import React, { useEffect, useRef, useState } from "react";
import { View, Text, Modal, Pressable, Animated, Easing } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { T, FONT, tone as toneFor } from "../lib/theme";
import { Icon } from "../lib/icons";
import { guestName } from "../lib/levels";
import Shape from "./Shape";
import StampRow from "./StampRow";
import InkSplash from "./InkSplash";
import Confetti from "./Confetti";

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "");

// Tidslinje för stämpelögonblicket (ms från att arket öppnas).
const DROP_AT = 260;      // stämpeln börjar falla
const DROP_MS = 280;
const HIT_1 = DROP_AT + DROP_MS;
const REDROP_AT = 900;    // dubbelstämpel: andra stämpeln
const HIT_2 = REDROP_AT + 240;

// Arket som kommer upp efter en lyckad tap. Stämpeln slår ner på arket med ett
// litet tryck (squash), bläckstänk i butikens färg, en våg och en vibration.
//   card.added === 2 → dubbelstämpel: två nedslag, "+1" blir "+2" med limegnistor
//   card.first       → kundens första stämpel någonsin: välkomsttext + konfetti
//   card.quiet       → dubbelstämpeln kom från butikens lugna timme (v8)
//   card.levelUp     → besöket gav en ny stamgästnivå hos stället (v11): märket poppar fram
// Stängs av App efter några sekunder.
export default function StampSheet({ card, onClose }) {
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  const drop = useRef(new Animated.Value(0)).current;
  const drop2 = useRef(new Animated.Value(0)).current;   // dubbelstämpel: andra stämpeln faller ovanpå
  const squash = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const wave = useRef(new Animated.Value(0)).current;
  const badge = useRef(new Animated.Value(0)).current;
  const medal = useRef(new Animated.Value(0)).current;   // v11: ny stamgästnivå
  const [hits, setHits] = useState(0);

  useEffect(() => {
    if (!card) return;
    const double = card.added === 2;
    const timers = [];
    [rise, drop, drop2, squash, shake, wave, badge, medal].forEach((v) => v.setValue(0));
    setHits(0);
    if (card.levelUp) {
      // Märket poppar fram när stämpeln (eller den andra stämpeln) har landat
      const at = (double ? HIT_2 : HIT_1) + 420;
      Animated.spring(medal, { toValue: 1, friction: 5, tension: 90, delay: at, useNativeDriver: true }).start();
      timers.push(setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), at));
    }

    const hit = (n) => {
      setHits(n);
      squash.setValue(0);
      Animated.sequence([
        Animated.timing(squash, { toValue: 1, duration: 70, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(squash, { toValue: 0, friction: 3.5, tension: 160, useNativeDriver: true }),
      ]).start();
      shake.setValue(0);
      Animated.timing(shake, { toValue: 1, duration: 320, easing: Easing.linear, useNativeDriver: true }).start();
      wave.setValue(0);
      Animated.timing(wave, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      if (n === 2) Animated.spring(badge, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start();
      if (card.first && n === 1) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else Haptics.impactAsync(n === 2 ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium);
    };

    Animated.spring(rise, { toValue: 1, friction: 9, tension: 70, useNativeDriver: true }).start();
    Animated.timing(drop, { toValue: 1, duration: DROP_MS, delay: DROP_AT, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start();
    timers.push(setTimeout(() => hit(1), HIT_1));
    if (double) {
      Animated.timing(drop2, { toValue: 1, duration: HIT_2 - REDROP_AT, delay: REDROP_AT, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start();
      timers.push(setTimeout(() => hit(2), HIT_2));
    }
    return () => timers.forEach(clearTimeout);
  }, [card]);

  if (!card) return null;
  const t = toneFor(card.ink);
  const needed = Math.max(1, card.needed || 1);
  const stamps = Math.max(0, Math.min(card.stamps || 0, needed));
  const left = needed - stamps;
  const double = card.added === 2;
  const reward = lowerFirst(card.rewardShort || card.reward);
  const pops = double
    ? [{ index: stamps - 2, delay: HIT_1 + 80 }, { index: stamps - 1, delay: HIT_2 + 80 }]
    : [{ index: stamps - 1, delay: HIT_1 + 80 }];

  const title = card.first ? "Din första stämpel!" : (double ? "Dubbelstämpel hos " : "Stämpel hos ") + card.name;
  const sub = card.first
    ? stamps + " av " + needed + " hos " + card.name + ". Samla " + left + " till för " + reward + "."
    : left === 1
      ? stamps + " av " + needed + " – nästa är gratis!"
      : stamps + " av " + needed + " – " + left + " kvar till " + reward + ".";

  const shakeX = shake.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -6, 6, -4, 2, 0] });

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityLabel="Stäng" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: T.scrim }} />
        <Animated.View style={{
          backgroundColor: T.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
          paddingHorizontal: 24, paddingTop: 10, paddingBottom: 28 + insets.bottom, alignItems: "center",
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [480, 0] }) }, { translateX: shakeX }],
        }}>
          <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: T.outline }} />

          {(card.first || card.quiet) && (
            <Text style={{ marginTop: 16, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.96, color: card.first ? t.primary : T.onTertiaryContainer }}>
              {card.first ? "VÄLKOMMEN TILL TAPPASS" : "LUGN TIMME · 2 STÄMPLAR"}
            </Text>
          )}

          <View style={{ width: 200, height: 160, marginTop: card.first || card.quiet ? 6 : 18, alignItems: "center", justifyContent: "center" }}>
            <Shape kind="sunny8" size={30} color={t.container} style={{ position: "absolute", left: 6, top: 18 }} />
            <Shape kind="cookie9" size={22} color={t.deco} style={{ position: "absolute", right: 16, top: 8 }} />
            <Shape kind="cookie9" size={16} color={t.primary} style={{ position: "absolute", right: 22, bottom: 10 }} />

            {/* Vågen från nedslaget */}
            <Animated.View style={{ position: "absolute", opacity: wave.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.75, 0] }), transform: [{ scale: wave.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.6] }) }] }}>
              <Shape kind="sunny8" size={150} color={hits === 2 ? T.lime : t.container} />
            </Animated.View>

            {/* Stämpeln: faller, slår ner (squash) och studsar tillbaka */}
            <Animated.View style={{
              opacity: drop.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
              transform: [
                { translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-150, 0] }) },
                { scale: drop.interpolate({ inputRange: [0, 1], outputRange: [1.45, 1] }) },
                { rotate: drop.interpolate({ inputRange: [0, 1], outputRange: ["-16deg", "0deg"] }) },
                { scaleX: squash.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] }) },
                { scaleY: squash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.84] }) },
              ],
            }}>
              <Shape kind="burst12" size={132} color={t.primary}>
                <Text style={{ fontFamily: FONT.display, fontSize: 46, color: "#FFFFFF" }}>+{hits === 2 ? 2 : 1}</Text>
              </Shape>
            </Animated.View>

            {/* Dubbelstämpel: andra stämpeln faller ovanpå den första och smälter ihop till +2 */}
            {double && hits < 2 && (
              <Animated.View style={{
                position: "absolute",
                opacity: drop2.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
                transform: [
                  { translateY: drop2.interpolate({ inputRange: [0, 1], outputRange: [-150, 0] }) },
                  { scale: drop2.interpolate({ inputRange: [0, 1], outputRange: [1.45, 1] }) },
                  { rotate: drop2.interpolate({ inputRange: [0, 1], outputRange: ["14deg", "0deg"] }) },
                ],
              }}>
                <Shape kind="burst12" size={132} color={t.primary}>
                  <Text style={{ fontFamily: FONT.display, fontSize: 46, color: "#FFFFFF" }}>+1</Text>
                </Shape>
              </Animated.View>
            )}

            {hits > 0 && (
              <InkSplash key={"splash" + hits} radius={hits === 2 ? 104 : 92} count={hits === 2 ? 14 : 12}
                colors={hits === 2 ? [T.lime, t.primary, T.lime, "#FFFFFF"] : [t.primary, t.deco, t.primary, t.container]} />
            )}

            {double && (
              <Animated.View style={{ position: "absolute", right: 8, top: 4, opacity: badge, transform: [{ scale: badge.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }, { rotate: "12deg" }] }}>
                <Shape kind="burst12" size={54} color={T.lime}>
                  <Text style={{ fontFamily: FONT.display, fontSize: 18, color: T.onPrimaryContainer }}>×2</Text>
                </Shape>
              </Animated.View>
            )}
          </View>

          <Text style={{ marginTop: 10, fontFamily: FONT.title, fontSize: 24, lineHeight: 32, color: T.ink, textAlign: "center" }}>{title}</Text>
          <Text style={{ marginTop: 4, fontFamily: left === 1 && !card.first ? FONT.semibold : FONT.regular, fontSize: 16, lineHeight: 24, color: left === 1 && !card.first ? t.primary : T.inkSoft, textAlign: "center" }}>
            {sub}
          </Text>

          <View style={{ marginTop: 18 }}>
            <StampRow total={needed} filled={stamps} tone={t} size={30} pops={pops} glowIndex={left === 1 ? stamps : -1} />
          </View>

          {!!card.levelUp && (
            <Animated.View
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={"Ny nivå: du är " + guestName(card.levelUp) + " hos " + card.name}
              style={{
                marginTop: 18, alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 12,
                padding: 12, paddingRight: 16, borderRadius: 20, backgroundColor: card.levelUp.bg,
                opacity: medal.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
                transform: [{ scale: medal.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
              }}
            >
              <Shape kind="burst12" size={44} color={card.levelUp.accent}>
                <Icon name="award" size={22} color="#FFFFFF" strokeWidth={2.4} />
              </Shape>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: FONT.bold, fontSize: 11, letterSpacing: 0.88, color: card.levelUp.ink }}>NY NIVÅ</Text>
                <Text style={{ fontFamily: FONT.title, fontSize: 17, lineHeight: 22, color: card.levelUp.ink }}>
                  Du är {guestName(card.levelUp)} hos {card.name}
                </Text>
              </View>
            </Animated.View>
          )}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => ({ marginTop: 24, alignSelf: "stretch", height: 56, borderRadius: 28, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}
          >
            <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>{card.first ? "Toppen!" : "Klart"}</Text>
          </Pressable>
        </Animated.View>

        {card.first && hits > 0 && <Confetti count={34} colors={[t.primary, t.deco, T.lime, t.container, "#FFFFFF"]} />}
      </View>
    </Modal>
  );
}

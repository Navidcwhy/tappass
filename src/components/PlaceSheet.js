import React, { useEffect, useRef } from "react";
import { View, Text, Modal, Pressable, Animated, Easing, ScrollView, Platform, Linking, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { T, FONT, tone as toneFor } from "../lib/theme";
import { Icon } from "../lib/icons";
import { openState, openText, hoursLines, siteLabel, instagramUrl } from "../lib/hours";
import { quietSummary } from "../lib/quiet";
import { levelFor, progressText } from "../lib/levels";
import CafeAvatar from "./CafeAvatar";
import LevelPill from "./LevelPill";

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "");

// Kartlänk: Apple Kartor på iPhone, Google Maps annars.
export function mapsUrl(cafe) {
  const q = encodeURIComponent([cafe.address, cafe.city].filter(Boolean).join(", ") || cafe.name);
  return Platform.OS === "ios" ? "https://maps.apple.com/?q=" + q : "https://www.google.com/maps/search/?api=1&query=" + q;
}

// Ställets sida (v13): det butiken själv fyllt i — logga, beskrivning, öppettider, adress,
// webbplats och Instagram — plus belöningen, lugna timmar och kundens eget kort/nivå.
//   cafe — ställe (normaliserat), null = stängd
//   card — kundens kort hos stället, om det finns
export default function PlaceSheet({ cafe, card, onClose }) {
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  const snap = useRef(cafe);
  if (cafe) snap.current = cafe;
  const c = cafe || snap.current;

  useEffect(() => {
    if (!cafe) return;
    rise.setValue(0);
    Animated.timing(rise, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [cafe && cafe.slug]);

  if (!cafe || !c) return null;
  const t = toneFor(c.ink);
  const open = openState(c.openingHours);
  const meta = [c.type, c.area].filter(Boolean).join(" · ");
  const hours = hoursLines(c.openingHours);
  const quiet = quietSummary(c.quietHours);
  const visits = card && card.hasLevels ? card.visits : 0;
  const level = levelFor(visits);
  const go = (url) => { Haptics.selectionAsync(); Linking.openURL(url).catch(() => {}); };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityLabel="Stäng" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: T.scrim }} />
        <Animated.View style={{
          maxHeight: Dimensions.get("window").height * 0.88,
          backgroundColor: T.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
        }}>
          <View style={{ alignItems: "center", paddingTop: 10 }}>
            <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: T.outline }} />
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 + insets.bottom }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <CafeAvatar cafe={c} size={64} color={t.primary} fontSize={26} />
              <View style={{ flex: 1 }}>
                <Text accessibilityRole="header" style={{ fontFamily: FONT.title, fontSize: 24, lineHeight: 30, color: T.ink }}>{c.name}</Text>
                {!!meta && <Text style={{ fontFamily: FONT.regular, fontSize: 15, lineHeight: 20, color: T.inkSoft }}>{meta}</Text>}
              </View>
            </View>

            {!!open && (
              <View style={{ marginTop: 14, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: open.open ? "#DDF0DE" : T.container }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: open.open ? "#2E7D32" : T.inkMute }} />
                <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: open.open ? "#1B4D1E" : T.inkSoft }}>{openText(open)}</Text>
              </View>
            )}

            {!!c.description && (
              <Text style={{ marginTop: 14, fontFamily: FONT.regular, fontSize: 16, lineHeight: 24, color: T.ink }}>{c.description}</Text>
            )}

            <View style={{ marginTop: 18, borderRadius: 24, backgroundColor: T.surface, borderWidth: 1, borderColor: T.hairline, overflow: "hidden" }}>
              <Row icon="gift" title={(c.rewardShort || c.reward) + (c.needed ? " efter " + c.needed + " stämplar" : "")}
                sub={(c.tiers || []).length ? "Eller " + c.tiers.map((x) => lowerFirst(x.text) + " vid " + x.at).join(", ") : null} />
              {!!quiet && <Row icon="timer" title="Dubbla stämplar" sub={quiet} />}
              {hours.length > 0 && <Row icon="clock" title="Öppettider" sub={hours.join("\n")} />}
              {!!c.address && <Row icon="pin" title={c.address} sub="Visa på kartan" onPress={() => go(mapsUrl(c))} />}
              {!!c.website && <Row icon="globe" title={siteLabel(c.website)} onPress={() => go(c.website)} />}
              {!!c.instagram && <Row icon="at" title={"@" + c.instagram} sub="Instagram" onPress={() => go(instagramUrl(c.instagram))} />}
            </View>

            {!!card && (
              <View style={{ marginTop: 14, padding: 16, borderRadius: 24, backgroundColor: t.container, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ flex: 1, fontFamily: FONT.title, fontSize: 16, color: t.onContainer }}>Ditt kort</Text>
                  {level && <LevelPill level={level} place={c.name} />}
                </View>
                <Text style={{ fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: t.muted }}>
                  {card.pendingReward ? "Sparad belöning väntar på inlösen" : (card.stamps || 0) + " av " + card.needed + " stämplar"}
                  {visits > 0 ? " · " + progressText(visits) : ""}
                </Text>
              </View>
            )}

            <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 20, height: 52, borderRadius: 26, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}>
              <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>Stäng</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Row({ icon, title, sub, onPress }) {
  const body = (
    <>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: T.container, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} color={T.ink} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20, color: T.ink }}>{title}</Text>
        {!!sub && <Text style={{ marginTop: 2, fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: T.inkSoft }}>{sub}</Text>}
      </View>
      {!!onPress && <Icon name="external" size={18} color={T.inkMute} />}
    </>
  );
  const style = { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: T.hairline, marginTop: -1 };
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="link" style={({ pressed }) => [style, { backgroundColor: pressed ? T.container : "transparent" }]}>{body}</Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}

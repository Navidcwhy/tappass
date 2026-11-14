import React, { useEffect, useRef, useState } from "react";
import { View, Text, Modal, Pressable, Animated, Easing, ScrollView, TextInput, KeyboardAvoidingView, Dimensions, ActivityIndicator, Share } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { T, FONT } from "../lib/theme";
import { Icon } from "../lib/icons";
import Shape from "./Shape";
import { getInviteCode, redeemInvite } from "../lib/supabase";
import { INVITE_STAMPS, INVITE_DAYS, cleanInviteCode, validInviteCode, formatInviteCode, shareText, inviteErrorText, enteredText, friendsText, dayText } from "../lib/invite";

// Bjud in en vän (v16): din kod att dela, och — för nya kunder — en väns kod att ange.
//   visible
//   status    — invite_status (appen håller det senaste läget)
//   onChanged — nytt läge från servern ({ status }) eller en inlöst kod ({ redeemed: svar })
//   onClose
export default function InviteSheet({ visible, status, onChanged, onClose }) {
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  const mounted = useRef(true);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);   // text efter en lyckad kod
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = async () => {
    setLoading(true); setLoadErr(false);
    const r = await getInviteCode();   // skapar koden första gången
    if (!mounted.current) return;
    setLoading(false);
    if (r.ok && !r.unavailable) { if (onChanged) onChanged({ status: r }); }
    else setLoadErr(true);
  };

  useEffect(() => {
    if (!visible) return;
    setCode(""); setError(null); setDone(null); setBusy(false);
    rise.setValue(0);
    Animated.timing(rise, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    load();
  }, [visible]);

  if (!visible) return null;

  const my = status && status.code;
  const share = () => {
    if (!my) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Share.share({ message: shareText(my) }).catch(() => {});
  };
  const submit = async () => {
    if (busy || !validInviteCode(code)) return;
    setBusy(true); setError(null);
    const r = await redeemInvite(cleanInviteCode(code));
    if (!mounted.current) return;
    setBusy(false);
    if (!r.ok || r.unavailable) {
      setError(inviteErrorText(r.unavailable ? "network" : r));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDone(r.status === "rewarded"
      ? "Ni fick " + INVITE_STAMPS + " stämplar var hos " + r.cafe_name + "!"
      : "Klart! Stämpla hos ett TapPass-ställe senast " + dayText(r.until) + " så får ni " + INVITE_STAMPS + " stämplar var.");
    if (onChanged) onChanged({ redeemed: r });
  };

  const entered = status && status.entered;
  const canRedeem = !!(status && status.can_redeem) && !entered;
  const friends = friendsText(status);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityLabel="Stäng" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: T.scrim }} />
        <Animated.View style={{
          maxHeight: Dimensions.get("window").height * 0.92,
          backgroundColor: T.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
        }}>
          <View style={{ alignItems: "center", paddingTop: 10 }}>
            <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: T.outline }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 + insets.bottom }}>
            <View style={{ alignItems: "center" }}>
              <Shape kind="clover4" size={84} color={T.secondaryContainer}>
                <Icon name="friends" size={34} color={T.onSecondaryContainer} />
              </Shape>
            </View>
            <Text accessibilityRole="header" style={{ marginTop: 14, fontFamily: FONT.title, fontSize: 26, lineHeight: 32, color: T.ink, textAlign: "center" }}>Bjud in en vän</Text>
            <Text style={{ marginTop: 8, fontFamily: FONT.regular, fontSize: 16, lineHeight: 23, color: T.inkSoft, textAlign: "center" }}>
              När din vän stämplar första gången får ni {INVITE_STAMPS} stämplar var hos det stället. Vännen anger din kod i appen inom {INVITE_DAYS} dagar från att den laddats ner.
            </Text>

            <View style={{ marginTop: 18, paddingVertical: 18, paddingHorizontal: 16, borderRadius: 24, backgroundColor: T.surface, borderWidth: 1, borderColor: T.hairline, alignItems: "center" }}>
              <Text style={{ fontFamily: FONT.bold, fontSize: 12, letterSpacing: 1.44, color: T.inkMute }}>DIN KOD</Text>
              {my ? (
                <Text accessible accessibilityLabel={"Din kod " + my.split("").join(" ")} selectable style={{ marginTop: 6, fontFamily: FONT.display, fontSize: 40, lineHeight: 48, letterSpacing: 4, color: T.ink }}>{formatInviteCode(my)}</Text>
              ) : loading ? (
                <ActivityIndicator style={{ marginVertical: 14 }} color={T.inkMute} />
              ) : (
                <Text style={{ marginTop: 10, fontFamily: FONT.medium, fontSize: 15, color: T.inkSoft, textAlign: "center" }}>{loadErr ? "Kunde inte hämta din kod just nu." : ""}</Text>
              )}
              {my ? (
                <Pressable onPress={share} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 14, height: 48, paddingHorizontal: 22, borderRadius: 24, backgroundColor: T.primary, flexDirection: "row", alignItems: "center", gap: 10, opacity: pressed ? 0.88 : 1 })}>
                  <Icon name="share" size={20} color="#FFFFFF" />
                  <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>Dela koden</Text>
                </Pressable>
              ) : loadErr ? (
                <Pressable onPress={load} accessibilityRole="button" style={{ marginTop: 8, minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }}>
                  <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: T.primary }}>Försök igen</Text>
                </Pressable>
              ) : null}
              {!!friends && <Text style={{ marginTop: 12, fontFamily: FONT.medium, fontSize: 14, color: T.inkSoft }}>{friends}</Text>}
            </View>

            {(canRedeem || entered || done) && (
              <View style={{ marginTop: 18 }}>
                <Text style={{ marginLeft: 4, fontFamily: FONT.title, fontSize: 17, color: T.ink }}>Har du fått en kod?</Text>
                {done || entered ? (
                  <View style={{ marginTop: 10, padding: 14, borderRadius: 20, backgroundColor: (done || entered.status !== "expired") ? T.primaryContainer : T.container, flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <Icon name={done || entered.status === "rewarded" ? "check" : entered.status === "expired" ? "info" : "timer"} size={20} color={T.onPrimaryContainer} />
                    <Text style={{ flex: 1, fontFamily: FONT.medium, fontSize: 15, lineHeight: 21, color: T.onPrimaryContainer }}>{done || enteredText(entered)}</Text>
                  </View>
                ) : (
                  <>
                    <TextInput
                      value={formatInviteCode(code)}
                      onChangeText={(s) => { setCode(cleanInviteCode(s)); setError(null); }}
                      onSubmitEditing={submit}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      maxLength={7}
                      placeholder="K7M 3QF"
                      placeholderTextColor={T.outline}
                      accessibilityLabel="Väns kod"
                      returnKeyType="done"
                      style={{ marginTop: 10, height: 60, borderRadius: 18, backgroundColor: T.surface, borderWidth: 2, borderColor: validInviteCode(code) ? T.primary : T.outline, fontFamily: FONT.display, fontSize: 26, letterSpacing: 4, color: T.ink, textAlign: "center", paddingVertical: 0 }}
                    />
                    {!!error && (
                      <View accessibilityLiveRegion="polite" style={{ marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: T.errorContainer, flexDirection: "row", gap: 10 }}>
                        <Icon name="alert" size={20} color={T.onErrorContainer} />
                        <Text style={{ flex: 1, fontFamily: FONT.medium, fontSize: 14, lineHeight: 20, color: T.onErrorContainer }}>{error}</Text>
                      </View>
                    )}
                    <Pressable onPress={validInviteCode(code) && !busy ? submit : undefined} accessibilityRole="button" accessibilityState={{ disabled: !validInviteCode(code) || busy }}
                      style={({ pressed }) => ({ marginTop: 12, height: 52, borderRadius: 26, backgroundColor: T.secondaryContainer, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, opacity: !validInviteCode(code) && !busy ? 0.5 : pressed ? 0.88 : 1 })}>
                      {busy && <ActivityIndicator size="small" color={T.onSecondaryContainer} />}
                      <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: T.onSecondaryContainer }}>Använd koden</Text>
                    </Pressable>
                    {!!(status && status.redeem_until) && (
                      <Text style={{ marginTop: 8, fontFamily: FONT.regular, fontSize: 13, color: T.inkSoft, textAlign: "center" }}>Koder kan anges till och med {dayText(status.redeem_until)}.</Text>
                    )}
                  </>
                )}
              </View>
            )}

            <Text style={{ marginTop: 16, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19, color: T.inkSoft, textAlign: "center" }}>
              Bara riktiga stämplingar i kassan räknas. En väns kod per telefon eller konto.
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 16, height: 52, borderRadius: 26, backgroundColor: T.container, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}>
              <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: T.ink }}>Stäng</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

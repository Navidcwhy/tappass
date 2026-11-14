import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Modal, Pressable, Animated, Easing, Dimensions, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { T, FONT, tone as toneFor } from "../lib/theme";
import { Icon } from "../lib/icons";
import { claimBirthday, getBirthdayCode, redeemBirthdayByTap } from "../lib/supabase";
import { dateText } from "../lib/birthday";
import { IS_IOS, readToken, cancelNfc, setIosAlert, isCancelOrTimeout } from "../lib/nfc";
import useReduceMotion from "../lib/useReduceMotion";
import { TapScreen, CodeScreen, tapErrorText, DISSOLVE_MS, genitive, clock } from "./RewardSheet";
import Shape from "./Shape";
import CafeAvatar from "./CafeAvatar";
import Confetti from "./Confetti";

export const PINK = "#F2AFC4";
const CONFETTI = [PINK, T.lime, T.primary, T.tertiaryContainer, "#FFFFFF"];

// Födelsedagsveckans presenter (v15). Inlösen som en belöning: personalen håller
// butikens stämpel mot telefonen (redeem_birthday_by_tap) eller skriver in koden i
// panelen; rutan frågar varannan sekund (birthday_code). Stämpelkortet rörs inte.
//   status         — birthday_status (window + gifts)
//   cafes          — normaliserade ställen (logga och färg)
//   registerRedeem — som RewardSheet: lästa stämplar skickas hit medan arket är öppet
//   onChanged      — en present har lösts in (appen hämtar läget igen)
export default function BirthdaySheet({ visible, status, cafes, registerRedeem, onChanged, onClose }) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const rise = useRef(new Animated.Value(0)).current;
  const [stage, setStage] = useState("list");   // list | tap | revealed | dissolve | redeemed
  const [gift, setGift] = useState(null);
  const [code, setCode] = useState(null);
  const [claiming, setClaiming] = useState(null); // slug medan "Lös in" hämtar koden
  const [listError, setListError] = useState(null);
  const [tapState, setTapState] = useState(IS_IOS ? "idle" : "waiting");
  const [tapError, setTapError] = useState(null);
  const [offline, setOffline] = useState(false);
  const [redeemedAt, setRedeemedAt] = useState(null);
  const [via, setVia] = useState("code");
  const [openKey, setOpenKey] = useState(0);
  const doneRef = useRef(false);
  const busyRef = useRef(false);
  const autoScanRef = useRef(false);
  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; });

  const gifts = (status && Array.isArray(status.gifts)) ? status.gifts : [];
  const cafeOf = (slug) => (cafes || []).find((c) => c.slug === slug) || { slug, name: slug };

  useEffect(() => {
    if (!visible) return;
    setStage("list"); setGift(null); setCode(null); setClaiming(null); setListError(null); setTapError(null);
    setOpenKey((k) => k + 1);
    rise.setValue(0);
    Animated.timing(rise, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible]);

  const finish = useCallback((how, at) => {
    if (doneRef.current) return;
    doneRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setVia(how);
    setRedeemedAt(at ? new Date(at) : new Date());
    setStage((s) => (s === "revealed" ? "dissolve" : "redeemed"));
    if (onChangedRef.current) onChangedRef.current();
  }, []);

  // "Lös in": presenten får en kod (samma om den redan finns) och rutan väntar på stämpeln
  const open = async (g) => {
    if (claiming) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setListError(null);
    setClaiming(g.cafe_slug);
    const r = await claimBirthday(g.cafe_slug);
    setClaiming(null);
    if (!r.ok) {
      if (r.error === "already_redeemed" && onChangedRef.current) onChangedRef.current();
      setListError(r.error === "already_redeemed" ? "Presenten hos " + g.cafe_name + " är redan inlöst."
        : r.error === "not_eligible" ? "Presenten hos " + g.cafe_name + " gäller inte längre."
        : "Ingen anslutning. Försök igen om en stund.");
      return;
    }
    doneRef.current = false;
    busyRef.current = false;
    autoScanRef.current = true;
    setGift(g);
    setCode(r.code || null);
    setTapError(null);
    setOffline(false);
    setTapState(IS_IOS ? "idle" : "waiting");
    setStage("tap");
  };

  // Pollning medan presenten väntar (stämpel eller kod) — bara ett säkert "inlöst" räknas
  useEffect(() => {
    if (!visible || !gift || (stage !== "tap" && stage !== "revealed")) return undefined;
    let alive = true;
    const check = async () => {
      if (busyRef.current) return;
      const r = await getBirthdayCode(gift.cafe_slug);
      if (!alive || doneRef.current || busyRef.current) return;
      if (!r.ok) { setOffline(true); return; }
      setOffline(false);
      if (r.redeemed) finish("code", r.redeemedAt);
    };
    check();
    const id = setInterval(check, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [visible, gift, stage, finish]);

  // Butikens stämpel lästes. I listan: lös in presenten hos stämpelns ställe (fel ställe
  // först → servern säger vilket, och har kunden en present där provas det).
  const onTag = async (token) => {
    if (doneRef.current || busyRef.current) return;
    const left = gifts.filter((g) => g.status !== "redeemed");
    const first = stage === "list" ? left[0] : gift;
    if (!first) return;
    busyRef.current = true;
    setTapError(null); setListError(null);
    if (stage !== "list") setTapState("reading");
    let target = first;
    let r = await redeemBirthdayByTap(target.cafe_slug, token);
    if (!r.ok && r.error === "wrong_tag" && stage === "list") {
      const other = left.find((g) => g.cafe_name === r.got);
      if (other) { target = other; r = await redeemBirthdayByTap(other.cafe_slug, token); }
    }
    busyRef.current = false;
    if (doneRef.current) return;
    if (r.ok) {
      setGift(target);
      finish(r.already ? "code" : "tap", r.redeemed_at);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (stage === "list") {
      const e = tapErrorText({ kind: r.error === "not_eligible" ? "network" : r.error || "network", expected: r.expected }, target.cafe_name);
      setListError(r.error === "not_eligible" ? "Ingen present att lösa in där." : e.title + " – " + e.text);
    } else {
      setTapState(IS_IOS ? "idle" : "waiting");
      setTapError({ kind: r.error === "not_eligible" ? "network" : r.error || "network", expected: r.expected });
    }
  };
  const onTagRef = useRef(onTag);
  onTagRef.current = onTag;

  useEffect(() => {
    if (!registerRedeem || !visible || (stage !== "list" && stage !== "tap" && stage !== "revealed")) return undefined;
    registerRedeem((token) => onTagRef.current(token));
    return () => registerRedeem(null);
  }, [registerRedeem, visible, stage]);

  // iOS: en skanning per tryck (och direkt efter "Lös in")
  const scanIos = async () => {
    if (!IS_IOS || busyRef.current || doneRef.current || !gift) return;
    setTapError(null);
    setTapState("scanning");
    try {
      const token = await readToken({ alertMessage: "Håll iPhonen mot " + genitive(gift.cafe_name) + " stämpel" });
      await (token ? setIosAlert("Stämpel läst") : Promise.resolve());
      await cancelNfc();
      if (token) await onTagRef.current(token);
      else { setTapState("idle"); setTapError({ kind: "unknown_tag", expected: gift.cafe_name }); }
    } catch (e) {
      await cancelNfc();
      setTapState("idle");
      if (!isCancelOrTimeout(e)) setTapError({ kind: "read" });
    }
  };
  const scanRef = useRef(scanIos);
  scanRef.current = scanIos;
  useEffect(() => {
    if (stage === "tap" && IS_IOS && autoScanRef.current) { autoScanRef.current = false; scanRef.current(); }
  }, [stage]);

  useEffect(() => {
    if (stage !== "dissolve") return undefined;
    const t = setTimeout(() => setStage("redeemed"), DISSOLVE_MS);
    return () => clearTimeout(t);
  }, [stage]);

  if (!visible) return null;

  const close = () => { if (IS_IOS) cancelNfc(); onClose(); };
  const back = () => { if (IS_IOS) cancelNfc(); setStage("list"); setGift(null); setTapError(null); };
  const cafe = gift ? cafeOf(gift.cafe_slug) : null;
  const t = toneFor(cafe ? cafe.ink : undefined);
  const card = gift ? { ...cafe, name: gift.cafe_name, reward: "Födelsedagspresent: " + gift.reward } : null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={stage === "list" ? close : back}>
      <View style={{ flex: 1 }}>
      {stage === "list" ? (
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable accessibilityLabel="Stäng" onPress={close} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: T.scrim }} />
          <Animated.View style={{
            maxHeight: Dimensions.get("window").height * 0.9,
            backgroundColor: T.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
            transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
          }}>
            <View style={{ alignItems: "center", paddingTop: 10 }}>
              <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: T.outline }} />
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 + insets.bottom }}>
              <View style={{ alignItems: "center" }}>
                <Shape kind="flower8" size={92} color={PINK} rotate={8}>
                  <Icon name="cake" size={40} color={T.onTertiaryContainer} />
                </Shape>
              </View>
              <Text accessibilityRole="header" style={{ marginTop: 14, fontFamily: FONT.title, fontSize: 28, lineHeight: 34, color: T.ink, textAlign: "center" }}>Grattis på födelsedagen!</Text>
              {!!(status && status.window) && (
                <Text style={{ marginTop: 6, fontFamily: FONT.regular, fontSize: 16, lineHeight: 23, color: T.inkSoft, textAlign: "center" }}>
                  Hämta dina presenter t.o.m. {dateText(status.window.to, { year: false })}.
                </Text>
              )}
              <View style={{ marginTop: 18, borderRadius: 24, backgroundColor: T.surface, borderWidth: 1, borderColor: T.hairline, overflow: "hidden" }}>
                {gifts.map((g, i) => (
                  <GiftRow key={g.cafe_slug} gift={g} cafe={cafeOf(g.cafe_slug)} first={i === 0} busy={claiming === g.cafe_slug} onOpen={() => open(g)} />
                ))}
              </View>
              {!!listError && (
                <View accessibilityLiveRegion="polite" style={{ marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: T.errorContainer, flexDirection: "row", gap: 10 }}>
                  <Icon name="alert" size={20} color={T.onErrorContainer} />
                  <Text style={{ flex: 1, fontFamily: FONT.medium, fontSize: 14, lineHeight: 20, color: T.onErrorContainer }}>{listError}</Text>
                </View>
              )}
              <Text style={{ marginTop: 14, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19, color: T.inkSoft, textAlign: "center" }}>
                Visa koden eller låt personalen hålla stämpeln mot telefonen. Presenten rör inte ditt stämpelkort – en present per ställe och år.
              </Text>
              <Pressable onPress={close} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 18, height: 52, borderRadius: 26, backgroundColor: T.secondaryContainer, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}>
                <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: T.onSecondaryContainer }}>Stäng</Text>
              </Pressable>
            </ScrollView>
          </Animated.View>
        </View>
      ) : stage === "tap" ? (
        <TapScreen card={card} tone={t} state={tapState} error={tapError} offline={offline} onScan={scanIos}
          onShowCode={() => { if (IS_IOS) cancelNfc(); setTapError(null); setStage("revealed"); }} onClose={back} />
      ) : stage === "revealed" || stage === "dissolve" ? (
        <CodeScreen card={card} tone={t} code={code} offline={offline} dissolving={stage === "dissolve"}
          note="Presenten rör inte ditt stämpelkort."
          onUseStamp={() => { setTapError(null); setTapState(IS_IOS ? "idle" : "waiting"); setStage("tap"); }} onClose={back} />
      ) : (
        <GiftRedeemed card={card} tone={t} via={via} at={redeemedAt} reduce={reduce} onDone={back} />
      )}
      {/* Konfetti en gång per öppning (inte igen när kunden kommer tillbaka till listan) */}
      {!reduce && <Confetti key={"fodelsedag" + openKey} count={30} colors={CONFETTI} />}
      </View>
    </Modal>
  );
}

function GiftRow({ gift, cafe, first, busy, onOpen }) {
  const t = toneFor(cafe.ink);
  const done = gift.status === "redeemed";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: first ? 0 : 1, borderTopColor: T.hairline }}>
      <CafeAvatar cafe={cafe} size={46} color={t.primary} fontSize={18} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20, color: T.ink }}>{gift.cafe_name}</Text>
        <Text style={{ marginTop: 2, fontFamily: FONT.regular, fontSize: 14, lineHeight: 19, color: T.inkSoft }}>{gift.reward}</Text>
      </View>
      {done ? (
        <View accessibilityLabel="Inlöst" style={{ height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: T.container, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="check" size={16} color={T.inkSoft} strokeWidth={2.6} />
          <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: T.inkSoft }}>Inlöst</Text>
        </View>
      ) : (
        <Pressable onPress={busy ? undefined : onOpen} accessibilityRole="button" accessibilityLabel={"Lös in presenten hos " + gift.cafe_name}
          style={({ pressed }) => ({ height: 40, minWidth: 92, paddingHorizontal: 16, borderRadius: 20, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}>
          {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: "#FFFFFF" }}>Lös in</Text>}
        </Pressable>
      )}
    </View>
  );
}

// Inlöst: bock, presenten och klockslaget (personalen ser att bekräftelsen är live)
function GiftRedeemed({ card, tone: t, via, at, reduce, onDone }) {
  const insets = useSafeAreaInsets();
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start();
  }, []);
  const S = Math.round(Math.min(220, Dimensions.get("window").width - 120));
  return (
    <View style={{ flex: 1, backgroundColor: T.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 16, alignItems: "center" }}>
      <View style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Pressable accessibilityLabel="Stäng" onPress={onDone} style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" }}>
          <Icon name="close" size={24} color={T.ink} />
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.medium, fontSize: 22, color: T.ink }}>{card ? card.name : ""}</Text>
      </View>
      <View style={{ flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }}>
        <Animated.View style={{ opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
          <Shape kind="cookie9" size={S} color={T.lime}>
            <Icon name="check" size={Math.round(S * 0.42)} color={T.onPrimaryContainer} strokeWidth={3} />
          </Shape>
        </Animated.View>
        <Text style={{ marginTop: 22, fontFamily: FONT.display, fontSize: 44, lineHeight: 50, color: T.ink }}>Inlöst!</Text>
        <Text style={{ marginTop: 8, fontFamily: FONT.title, fontSize: 22, lineHeight: 28, color: T.ink, textAlign: "center" }}>{card ? card.reward : ""}</Text>
        <Text style={{ marginTop: 8, fontFamily: FONT.semibold, fontSize: 16, color: t.primary }}>
          {(via === "tap" ? "Med stämpeln" : "Med koden") + " · kl. " + clock(at || new Date())}
        </Text>
        <View style={{ marginTop: 18, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, backgroundColor: T.tertiaryContainer }}>
          <Icon name="cake" size={18} color={T.onTertiaryContainer} />
          <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: T.onTertiaryContainer }}>Grattis på födelsedagen!</Text>
        </View>
      </View>
      <Pressable onPress={onDone} accessibilityRole="button" style={({ pressed }) => ({ alignSelf: "stretch", height: 54, borderRadius: 27, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>Klar</Text>
      </Pressable>
      {!reduce && <Confetti count={26} colors={CONFETTI} />}
    </View>
  );
}

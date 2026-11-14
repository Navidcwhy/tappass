import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Modal, Pressable, Animated, Easing, Dimensions, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { T, FONT, tone as toneFor } from "../lib/theme";
import { Icon } from "../lib/icons";
import { saveReward, getCurrentSavedCode, redeemByTap, cancelSavedReward } from "../lib/supabase";
import { rewardOptions, optionFor, bestReached } from "../lib/tiers";
import { IS_IOS, readToken, cancelNfc, setIosAlert, isCancelOrTimeout } from "../lib/nfc";
import useReduceMotion from "../lib/useReduceMotion";
import Shape from "./Shape";
import StampRow from "./StampRow";
import InkSplash from "./InkSplash";

const { width: W, height: H } = Dimensions.get("window");
const initialOf = (name) => (name || "?").trim().charAt(0).toUpperCase();
// "Miyabis", "Bryggans Bageris" — men "Ramen Bros" (slutar på s, x eller z)
const genitive = (name) => { const n = (name || "").trim(); return /[sxz]$/i.test(n) ? n : n + "s"; };
const clock = (d) => [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, "0")).join(".");

/* ──────────────────────────────────────────────────────────────
   Inlösen:
   1. Låst    — ark med förklaring + "Lös in". Knappen sparar belöningen
                (save_reward) och ger koden, som finns kvar som reserv.
   2. Stämpel — helskärm "Håll telefonen mot stämpeln". Personalen håller butikens
                TapPass-stämpel mot telefonen och appen löser in (redeem_by_tap, v9).
                Fel butiks stämpel → "Fel stämpel – använd X-stämpeln."
                Android läser i appens NFC-loop (App skickar hit via registerRedeem),
                iOS kör en skanning per tryck. "Visa sifferkod" byter till koden.
   2b. Kod    — helskärm med koden; personalen skriver in den i tappass.se/m.
                Appen pollar i båda lägena och märker när koden är inlöst; då löses
                siffrorna upp i partiklar.
   3. Inlöst  — en stor bock och klockslaget för inlösen (en gammal skärmdump syns
                på tiden); stämplarna lyfter från kortet, som börjar om på 0
                (eller på överskottet, se carryOf).
   ────────────────────────────────────────────────────────────── */

const DISSOLVE_MS = 800;   // koden löses upp innan "Inlöst!" visas
const DIGIT_GAP = 45;      // ms mellan siffrorna när de löses upp
const RESET_AT = 950;      // ms efter "Inlöst!" när stämplarna börjar lyfta
const LIFT_GAP = 70;       // ms mellan stämplarna som lyfter

// Stämplar utöver den inlösta belöningen följer med till nästa kort (v6). at = vald
// belöning (v10: en mindre belöning), annars hela kortet. Efter inlösen är plånbokens
// antal redan överskottet.
const carryOf = (card, at) => {
  const goal = at || Math.max(1, card?.needed || 1);
  const stamps = Math.max(0, card?.stamps || 0);
  return stamps >= goal ? stamps - goal : stamps;
};

// Varför inlösen med stämpeln inte gick (servern avgör, v9).
export function tapErrorText(err, name) {
  const store = (err && err.expected) || name;
  switch (err && err.kind) {
    case "wrong_tag": return { title: "Fel stämpel", text: "Använd " + store + "-stämpeln." };
    case "unknown_tag": return { title: "Ingen TapPass-stämpel", text: "Håll telefonen mot " + store + "-stämpeln." };
    case "not_complete": return { title: "Kortet är inte fullt än", text: "Belöningen går att lösa in när kortet är fullt." };
    case "choose_reward": return { title: "Välj belöning först", text: "Välj vilken belöning du vill ha och tryck Lös in." };
    case "unavailable": return { title: "Fungerar inte just nu", text: "Visa sifferkoden för personalen i stället." };
    case "read": return { title: "Kunde inte läsa stämpeln", text: "Håll stilla en sekund och försök igen." };
    default: return { title: "Ingen anslutning", text: "Försök igen, eller visa sifferkoden för personalen." };
  }
}

// Felbesked på det låsta arket (stämpeln lästes innan kunden tryckt "Lös in").
const lockedErrorText = (err, name) => { const e = tapErrorText(err, name); return e.title + " – " + e.text; };

export default function RewardSheet({ visible, card, onClose, onRedeemed, onCancelled, registerRedeem, autoRedeem = false, preferTier = null }) {
  const [stage, setStage] = useState("loading"); // loading | locked | tap | revealed | dissolve | redeemed
  const [code, setCode] = useState(null);
  const [carry, setCarry] = useState(0);         // överskottet, låst i ögonblicket koden löstes in
  const [via, setVia] = useState("code");        // "tap" | "code" — visas på bekräftelsen
  const [redeemedAt, setRedeemedAt] = useState(null);
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [tapState, setTapState] = useState(IS_IOS ? "idle" : "waiting"); // waiting | scanning | reading | idle
  const [tapError, setTapError] = useState(null);
  const [tierAt, setTierAt] = useState(null);    // v10: vald belöning (null = hela kortet)
  const [before, setBefore] = useState(0);       // stämplar på kortet när belöningen löstes in
  const tierRef = useRef(null);
  tierRef.current = tierAt;
  const doneRef = useRef(false);       // inlöst — händer bara en gång per öppning
  const busyRef = useRef(false);       // ett inlösenanrop i taget
  const autoScanRef = useRef(false);   // iOS: skanna direkt efter "Lös in"

  // Kortet kan byta skepnad (eller försvinna) när plånboken laddas om efter
  // inlösen — visa då senast kända kort så att bekräftelsen inte blinkar bort.
  const snap = useRef(card);
  if (card) snap.current = card;
  const c = card || snap.current;
  const slug = c?.slug;

  // Senaste onRedeemed utan att pollningen startar om vid varje omrendering i App.
  const onRedeemedRef = useRef(onRedeemed);
  useEffect(() => { onRedeemedRef.current = onRedeemed; });

  // Stängd ruta glömmer sitt läge, så att nästa öppning aldrig hinner visa förra
  // kortets kod eller "Inlöst!" en bildruta innan laddningen startar.
  useEffect(() => {
    if (!visible) { setStage("loading"); setCode(null); }
  }, [visible]);

  // "Lös in": sparar belöningen (ger koden som reserv) och väntar på stämpeln.
  const handleRedeem = async () => {
    const target = snap.current;
    if (!target) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    setSaveFailed(false);
    setTapError(null);
    // Flera belöningar (v10): skicka vald nivå. Annars som förut (fungerar även före v10).
    const hasTiers = (target.tiers || []).length > 0;
    const want = tierRef.current != null ? tierRef.current : (bestReached(target) || {}).at;
    const result = await saveReward(target.slug, hasTiers ? want : undefined);
    setSaving(false);
    if (result.ok && result.code) {
      setCode(result.code);
      if (hasTiers) setTierAt(result.tier_at != null ? Number(result.tier_at) : want);
      setTapError(null);
      setTapState(IS_IOS ? "idle" : "waiting");
      autoScanRef.current = true;
      setStage("tap");
    } else {
      setSaveFailed(true);   // nätfel e.d. — kunden kan försöka igen
    }
  };
  const handleRedeemRef = useRef(handleRedeem);
  handleRedeemRef.current = handleRedeem;
  const autoRedeemRef = useRef(autoRedeem);
  autoRedeemRef.current = autoRedeem;
  const preferRef = useRef(preferTier);
  preferRef.current = preferTier;

  // Vid öppning: hämta ev. redan sparad kod (då väntar rutan direkt på stämpeln). Vid
  // nätfel visas låst läge — "Lös in" anropar save_reward, som returnerar den sparade
  // koden om den redan finns.
  // Beroende på slug (inte card-objektet) så att en uppdaterad plånbok inte laddar om rutan.
  useEffect(() => {
    if (!visible || !slug) return;
    let alive = true;
    setStage("loading");
    setOffline(false);
    setSaving(false);
    setSaveFailed(false);
    setTapError(null);
    setTapState(IS_IOS ? "idle" : "waiting");
    doneRef.current = false;
    busyRef.current = false;
    autoScanRef.current = false;
    // v10: föreslå belöningen kunden valde i firandet, annars den största som nåtts.
    const start = snap.current;
    const reachable = (at) => at != null && (start?.stamps || 0) >= at;
    const fallback = (bestReached(start) || {}).at;
    const suggested = reachable(preferRef.current) ? preferRef.current : fallback;
    setTierAt(start && (start.tiers || []).length ? (suggested ?? null) : null);
    (async () => {
      const r = await getCurrentSavedCode(slug);
      if (!alive) return;
      if (r.ok && r.code) {
        setCode(r.code);
        if (r.tierAt != null && (start?.tiers || []).length) setTierAt(r.tierAt);
        setStage("tap");
      } else {
        setStage("locked");
        // Från firandet ("Lös in nu"): kunden har redan valt — spara direkt.
        if (autoRedeemRef.current) handleRedeemRef.current();
      }
    })();
    return () => { alive = false; };
  }, [visible, slug]);

  // Inlöst — med stämpeln eller för att koden försvann på servern. Bara en gång.
  const finish = useCallback((carryN, how) => {
    if (doneRef.current) return;
    doneRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const needed = Math.max(1, snap.current?.needed || 1);
    setBefore(Math.max(0, Math.min(snap.current?.stamps || 0, needed)));
    setCarry(carryN);
    setVia(how);
    setRedeemedAt(new Date());
    setStage((s) => (s === "revealed" ? "dissolve" : "redeemed"));
    onRedeemedRef.current(slug);
  }, [slug]);

  // Polla varannan sekund medan rutan väntar (stämpel eller kod), för att märka när
  // personalen löst in med koden. Bara ett säkert svar "ingen sparad kod" räknas som
  // inlöst. Ett nätfel stänger aldrig rutan — kunden ska kunna visa koden även i en
  // kassa med dålig täckning.
  useEffect(() => {
    if ((stage !== "tap" && stage !== "revealed") || !slug || !visible) return;
    let alive = true;
    let timer = null;

    const check = async () => {
      if (busyRef.current) return;        // en inlösen med stämpeln pågår
      const r = await getCurrentSavedCode(slug);
      if (!alive || doneRef.current || busyRef.current) return;
      if (!r.ok) { setOffline(true); return; }
      setOffline(false);
      if (!r.code) {
        alive = false;
        if (timer) clearInterval(timer);
        finish(carryOf(snap.current, tierRef.current), "code");   // kortet före inlösen — plånboken laddas om strax
      }
    };

    check();
    timer = setInterval(check, 2000);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [stage, slug, visible, finish]);

  // Butikens stämpel lästes medan rutan väntar: lös in (App skickar hit i stället för
  // att stämpla, se registerRedeem). Fel stämpel ger ett tydligt besked, inget annat.
  const onTag = async (token) => {
    if (doneRef.current || busyRef.current || !slug) return;
    busyRef.current = true;
    setTapError(null);
    setTapState("reading");
    const r = await redeemByTap(slug, token);
    busyRef.current = false;
    if (doneRef.current) return;
    if (r.ok) {
      finish(r.already ? carryOf(snap.current, tierRef.current) : Math.max(0, Number(r.carry_over) || 0), r.already ? "code" : "tap");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setTapState(IS_IOS ? "idle" : "waiting");
    setTapError({ kind: r.error || "network", expected: r.expected });
  };
  const onTagRef = useRef(onTag);
  onTagRef.current = onTag;

  // Även i låst läge: har kunden öppnat belöningen och personalen håller fram stämpeln
  // löses den in direkt (servern löser in ett fullt kort utan sparad kod).
  useEffect(() => {
    if (!registerRedeem || !visible || (stage !== "locked" && stage !== "tap" && stage !== "revealed")) return;
    registerRedeem((token) => onTagRef.current(token));
    return () => registerRedeem(null);
  }, [registerRedeem, visible, stage]);

  // iOS: en skanning per tryck (Core NFC visar systemets ark).
  const scanIos = async () => {
    if (!IS_IOS || busyRef.current || doneRef.current) return;
    setTapError(null);
    setTapState("scanning");
    try {
      const token = await readToken({ alertMessage: "Håll iPhonen mot " + genitive(c.name) + " stämpel" });
      if (token) {
        await setIosAlert("Stämpel läst");
        await cancelNfc();
        await onTagRef.current(token);
      } else {
        await cancelNfc();
        setTapState("idle");
        setTapError({ kind: "unknown_tag", expected: c.name });
      }
    } catch (e) {
      await cancelNfc();
      setTapState("idle");
      if (!isCancelOrTimeout(e)) setTapError({ kind: "read" });
    }
  };
  const scanIosRef = useRef(scanIos);
  scanIosRef.current = scanIos;

  // iOS: starta skanningen direkt när kunden just tryckt "Lös in" (inte när en
  // sparad belöning öppnas igen — då väljer kunden själv).
  useEffect(() => {
    if (stage === "tap" && IS_IOS && autoScanRef.current) {
      autoScanRef.current = false;
      scanIosRef.current();
    }
  }, [stage]);

  // Koden har lösts in: siffrorna löses upp, sedan kommer bekräftelsen.
  useEffect(() => {
    if (stage !== "dissolve") return;
    const t = setTimeout(() => setStage("redeemed"), DISSOLVE_MS);
    return () => clearTimeout(t);
  }, [stage]);

  if (!visible || !c) return null;

  const close = () => { if (IS_IOS) cancelNfc(); onClose(); };
  const showCode = () => { if (IS_IOS) cancelNfc(); setTapError(null); setStage("revealed"); };
  const backToStamp = () => { setTapError(null); setTapState(IS_IOS ? "idle" : "waiting"); setStage("tap"); };
  // v10: kunden ångrar en sparad mindre belöning och samlar vidare.
  const handleCancel = async () => {
    if (IS_IOS) cancelNfc();
    busyRef.current = true;
    const r = await cancelSavedReward(c.slug);
    busyRef.current = false;
    if (r.ok) {
      Haptics.selectionAsync();
      if (onCancelled) onCancelled(c.slug);
      onClose();
    } else {
      setTapError({ kind: "network" });
    }
  };
  const opt = optionFor(c, tierAt);
  const shown = tierAt != null ? { ...c, reward: opt.title } : c;   // rubriken = vald belöning
  const canCancel = tierAt != null && !opt.full;

  const t = toneFor(c.ink);
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      {stage === "loading" || stage === "locked" ? (
        <LockedSheet card={c} tone={t} tierAt={tierAt} onPickTier={setTierAt} loading={stage === "loading"} saving={saving || tapState === "reading"} saveFailed={saveFailed} tapError={tapError} onRedeem={handleRedeem} onClose={close} />
      ) : stage === "tap" ? (
        <TapScreen card={shown} tone={t} state={tapState} error={tapError} offline={offline} onScan={scanIos} onShowCode={showCode} onCancel={canCancel ? handleCancel : null} onClose={close} />
      ) : stage === "revealed" || stage === "dissolve" ? (
        <CodeScreen card={shown} tone={t} code={code} offline={offline} dissolving={stage === "dissolve"} onUseStamp={backToStamp} onClose={close} />
      ) : (
        <RedeemedScreen card={c} tone={t} carry={carry} before={before} via={via} at={redeemedAt} onClose={close} />
      )}
    </Modal>
  );
}

/* ────────────── 1. LÅST — ARK MED "LÖS IN" ────────────── */
function LockedSheet({ card, tone: t, tierAt, onPickTier, loading, saving, saveFailed, tapError, onRedeem, onClose }) {
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(rise, { toValue: 1, friction: 9, tension: 60, useNativeDriver: true }).start();
  }, []);
  const needed = Math.max(1, card.needed || 1);
  const carry = Math.min(carryOf(card, tierAt), needed);
  const options = rewardOptions(card);
  const picking = options.length > 1;                  // v10: kunden väljer belöning
  const title = picking ? optionFor(card, tierAt).title : card.reward;

  return (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <Pressable accessibilityLabel="Stäng" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: T.scrim }} />
      <Animated.View style={{
        backgroundColor: T.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
        paddingHorizontal: 24, paddingTop: 10, paddingBottom: 28 + insets.bottom,
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [500, 0] }) }],
      }}>
        <View style={{ alignSelf: "center", width: 32, height: 4, borderRadius: 2, backgroundColor: T.outline }} />

        <View style={{ marginTop: 20, flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Shape kind="cookie9" size={48} color={t.primary}>
            <Text style={{ fontFamily: FONT.bold, fontSize: 19, color: "#FFFFFF" }}>{initialOf(card.name)}</Text>
          </Shape>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontFamily: FONT.medium, fontSize: 14, color: T.inkSoft }}>{card.name}</Text>
            <Text style={{ fontFamily: FONT.title, fontSize: 24, lineHeight: 30, color: T.ink }}>{title}</Text>
          </View>
        </View>

        {loading ? (
          <View style={{ height: 268, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator size="large" color={t.primary} />
          </View>
        ) : (
          <View>
            {picking && <RewardPicker card={card} tone={t} options={options} tierAt={tierAt} onPick={onPickTier} />}
            <View style={{ marginTop: picking ? 8 : 20 }}>
              {!picking && <StepRow tone={t} icon="phone" text="Tryck på Lös in när du står i kassan" />}
              <StepRow tone={t} icon="nfc" text="Personalen håller butikens stämpel mot telefonen" />
              <StepRow tone={t} icon="reset" text={"Kortet börjar om på " + carry + "/" + needed + " när belöningen är inlöst"} />
            </View>
            <Pressable
              onPress={saving ? undefined : onRedeem}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Lös in"
              accessibilityState={{ busy: saving }}
              style={({ pressed }) => ({ marginTop: 22, height: 64, borderRadius: 32, backgroundColor: t.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, opacity: pressed ? 0.88 : 1 })}
            >
              {saving
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Icon name="nfc" size={22} color="#FFFFFF" strokeWidth={2.2} />}
              <Text style={{ fontFamily: FONT.semibold, fontSize: 17, color: "#FFFFFF" }}>{saving ? "Löser in…" : "Lös in"}</Text>
            </Pressable>
            <Text accessibilityLiveRegion="polite" style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: saveFailed || tapError ? T.errorText : T.inkSoft, textAlign: "center", marginTop: 12 }}>
              {tapError ? lockedErrorText(tapError, card.name)
                : saveFailed ? "Det gick inte att lösa in. Kontrollera nätet och försök igen."
                : "Belöningen kan bara lösas in en gång."}
            </Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

// Välj belöning (v10): de mindre belöningarna och huvudbelöningen. Belöningar kunden
// inte nått än visas men går inte att välja ("3 kvar").
function RewardPicker({ card, tone: t, options, tierAt, onPick }) {
  const stamps = Math.max(0, card.stamps || 0);
  const selected = tierAt != null ? tierAt : (options[options.length - 1] || {}).at;
  return (
    <View accessibilityRole="radiogroup" style={{ marginTop: 18, gap: 8 }}>
      {options.map((o) => {
        const reached = stamps >= o.at;
        const on = reached && o.at === selected;
        const rest = Math.max(0, stamps - o.at);
        return (
          <Pressable key={o.at} disabled={!reached} onPress={() => { Haptics.selectionAsync(); onPick(o.at); }}
            accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !reached }}
            accessibilityLabel={o.text + (reached ? ", " + o.at + " stämplar" : ", " + (o.at - stamps) + " stämplar kvar")}
            style={({ pressed }) => ({ minHeight: 60, paddingVertical: 10, paddingLeft: 10, paddingRight: 14, borderRadius: 18, borderWidth: 2,
              borderColor: on ? t.primary : T.outline, backgroundColor: on ? t.container : "transparent",
              flexDirection: "row", alignItems: "center", gap: 12, opacity: reached ? (pressed ? 0.85 : 1) : 0.55 })}>
            <Shape kind="cookie9" size={38} color={reached ? t.primary : t.deco}>
              <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: reached ? "#FFFFFF" : t.muted }}>{o.at}</Text>
            </Shape>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: FONT.semibold, fontSize: 16, lineHeight: 21, color: T.ink }}>{o.text}</Text>
              <Text style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: T.inkSoft }}>
                {reached ? (rest > 0 ? rest + (rest === 1 ? " stämpel" : " stämplar") + " blir kvar på kortet" : "Kortet börjar om från noll") : (o.at - stamps) + " kvar"}
              </Text>
            </View>
            <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? t.primary : T.outline, alignItems: "center", justifyContent: "center" }}>
              {on && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: t.primary }} />}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function StepRow({ tone: t, icon, text }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 56 }}>
      <Shape kind="sunny8" size={40} color={t.container}>
        <Icon name={icon} size={18} color={t.onContainer} />
      </Shape>
      <Text style={{ flex: 1, fontFamily: FONT.regular, fontSize: 15, lineHeight: 21, color: T.ink }}>{text}</Text>
    </View>
  );
}

/* ────────────── 2. LÖS IN MED STÄMPELN ────────────── */
// state: waiting (Android lyssnar) | scanning (iOS-arket är uppe) | reading (servern
// löser in) | idle (iOS: väntar på att kunden trycker Skanna)
function TapScreen({ card, tone: t, state, error, offline, onScan, onShowCode, onCancel, onClose }) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const pop = useRef(new Animated.Value(0)).current;
  const w1 = useRef(new Animated.Value(0)).current;
  const w2 = useRef(new Animated.Value(0)).current;
  const w3 = useRef(new Animated.Value(0)).current;
  const listening = state === "waiting" || state === "scanning";

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 7, tension: 50, useNativeDriver: true }).start();
  }, []);
  // Vågor ut från stämpeln medan telefonen lyssnar (står still med "Reducera rörelse").
  useEffect(() => {
    const waves = [w1, w2, w3];
    if (!listening || reduce) { waves.forEach((v) => { v.stopAnimation(); v.setValue(0); }); return; }
    const loops = waves.map((v) => Animated.loop(Animated.timing(v, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true })));
    const timers = loops.map((l, i) => setTimeout(() => l.start(), i * 800));
    return () => { timers.forEach(clearTimeout); loops.forEach((l) => l.stop()); };
  }, [listening, reduce]);

  const S = Math.round(Math.min(260, W - 80, H * 0.32));
  const core = Math.round(S * 0.6);
  const wave = (v) => (
    <Animated.View pointerEvents="none" style={{
      position: "absolute", width: core, height: core, borderRadius: core, borderWidth: 3, borderColor: t.primary,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.65] }) }],
    }} />
  );
  const err = error ? tapErrorText(error, card.name) : null;
  const reading = state === "reading";
  const status = reading ? "Löser in…"
    : offline ? "Ingen anslutning — försöker igen…"
    : IS_IOS ? (state === "scanning" ? "Håll iPhonen mot stämpeln…" : "Tryck på Skanna och håll iPhonen mot stämpeln")
    : "Redo — håll telefonen mot stämpeln";

  return (
    <View style={{ flex: 1, backgroundColor: T.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 16, alignItems: "center" }}>
      <View style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Pressable accessibilityLabel="Stäng" onPress={onClose} style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" }}>
          <Icon name="close" size={24} color={T.ink} />
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.medium, fontSize: 22, color: T.ink }}>{card.name}</Text>
      </View>

      <View style={{ flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }}>
        <Animated.View style={{ width: S, height: S, alignItems: "center", justifyContent: "center", opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }}>
          <Shape kind="sunny8" size={S} color={t.light} rotate={12} style={{ position: "absolute", left: 0, top: 0 }} />
          {wave(w1)}{wave(w2)}{wave(w3)}
          <Shape kind="cookie12" size={core} color={t.primary}>
            {reading
              ? <ActivityIndicator size="large" color="#FFFFFF" />
              : <Icon name="nfc" size={Math.round(core * 0.4)} color="#FFFFFF" strokeWidth={2.2} />}
          </Shape>
        </Animated.View>

        <Text style={{ marginTop: 24, fontFamily: FONT.title, fontSize: 26, lineHeight: 31, textAlign: "center", color: T.ink }}>{card.reward}</Text>
        <Text style={{ marginTop: 8, maxWidth: 330, fontFamily: FONT.regular, fontSize: 16, lineHeight: 22, color: T.inkSoft, textAlign: "center" }}>
          Personalen håller {genitive(card.name)} TapPass-stämpel mot din telefon.
        </Text>

        {err ? (
          <View accessibilityLiveRegion="polite" style={{ marginTop: 20, alignSelf: "stretch", flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, backgroundColor: T.errorContainer }}>
            <Icon name="alert" size={22} color={T.errorText} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FONT.bold, fontSize: 15, lineHeight: 20, color: T.errorText }}>{err.title}</Text>
              <Text style={{ fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: T.errorText }}>{err.text}</Text>
            </View>
          </View>
        ) : (
          <Text accessibilityLiveRegion="polite" style={{ marginTop: 20, fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20, color: offline ? T.errorText : T.ink, textAlign: "center" }}>{status}</Text>
        )}

        {IS_IOS && state !== "scanning" && !reading && (
          <Pressable onPress={onScan} accessibilityRole="button"
            style={({ pressed }) => ({ marginTop: 16, height: 56, paddingHorizontal: 24, borderRadius: 28, backgroundColor: t.primary, flexDirection: "row", alignItems: "center", gap: 10, opacity: pressed ? 0.88 : 1 })}>
            <Icon name="nfc" size={22} color="#FFFFFF" />
            <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>Skanna stämpeln</Text>
          </Pressable>
        )}
      </View>

      <Pressable onPress={onShowCode} accessibilityRole="button"
        style={({ pressed }) => ({ alignSelf: "stretch", height: 56, borderRadius: 28, borderWidth: 1, borderColor: T.outline, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, opacity: pressed ? 0.7 : 1 })}>
        <Icon name="keyboard" size={20} color={T.ink} />
        <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: T.ink }}>Visa sifferkod i stället</Text>
      </Pressable>
      {onCancel && !reading && (
        <Pressable onPress={onCancel} accessibilityRole="button"
          style={({ pressed }) => ({ marginTop: 6, height: 44, alignSelf: "center", paddingHorizontal: 16, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: T.inkSoft }}>Ångra – samla vidare</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ────────────── 2. KODEN — HELSKÄRM ────────────── */
function CodeScreen({ card, tone: t, code, offline, dissolving, onUseStamp, onClose }) {
  const insets = useSafeAreaInsets();
  const pop = useRef(new Animated.Value(0)).current;
  const gone = useRef(new Animated.Value(0)).current;   // 0 → 1 medan koden löses upp
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 7, tension: 50, useNativeDriver: true }).start();
  }, []);
  useEffect(() => {
    if (!dissolving) return;
    const a = Animated.timing(gone, { toValue: 1, duration: DISSOLVE_MS, easing: Easing.linear, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [dissolving]);

  // Formen skalas ner på låga skärmar så att allt får plats utan att skrolla.
  const S = Math.round(Math.min(320, W - 40, H * 0.42));
  const rows = code ? [code.slice(0, 3), code.slice(3)] : ["···", "···"];
  const fs = Math.round(S * 0.275);
  const box = Math.round(fs * 1.12);           // hela glyfen får plats (Android klipper annars)
  const pitch = Math.round(S * 0.265);         // avstånd mellan raderna, som förut
  const shrink = { inputRange: [0, 0.4, 1], outputRange: [1, 1.05, 0.4] };
  const fadeLate = gone.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1, 0] });
  const fadeEarly = gone.interpolate({ inputRange: [0, 0.25], outputRange: [1, 0], extrapolate: "clamp" });
  const splash = [t.primary, t.deco, T.lime, t.onContainer];

  return (
    <View style={{ flex: 1, backgroundColor: T.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 16, alignItems: "center" }}>
      <View style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Pressable accessibilityLabel="Stäng" onPress={onClose} style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" }}>
          <Icon name="close" size={24} color={T.ink} />
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.medium, fontSize: 22, color: T.ink }}>{card.name}</Text>
      </View>

      <View style={{ flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }}>
        <Animated.View style={{ width: S, height: S, alignItems: "center", justifyContent: "center", opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }}>
          <Animated.View style={{ position: "absolute", left: -Math.round(S * 0.02), top: -Math.round(S * 0.02), opacity: fadeLate, transform: [{ scale: gone.interpolate(shrink) }, { rotate: gone.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "50deg"] }) }] }}>
            <Shape kind="sunny8" size={Math.round(S * 1.04)} color={t.light} rotate={12} />
          </Animated.View>
          <Animated.View style={{ position: "absolute", left: Math.round(S * 0.03), top: Math.round(S * 0.03), opacity: fadeLate, transform: [{ scale: gone.interpolate(shrink) }] }}>
            <Shape kind="cookie12" size={Math.round(S * 0.94)} color={t.container} />
          </Animated.View>
          <Animated.Text style={{ fontFamily: FONT.bold, fontSize: 12, letterSpacing: 1.44, color: t.muted, opacity: fadeEarly }}>DIN KOD</Animated.Text>
          <View accessible accessibilityLabel={"Kod " + (code ? code.split("").join(" ") : "")} style={{ marginTop: 6, alignItems: "center" }}>
            {rows.map((row, r) => (
              <View key={r} style={{ flexDirection: "row", marginTop: r ? pitch - box : 0 }}>
                {row.split("").map((ch, i) => (
                  <Digit key={i} ch={ch} delay={(r * 3 + i) * DIGIT_GAP} dissolving={dissolving} size={fs} box={box} color={t.onContainer} splash={splash} />
                ))}
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.Text style={{ marginTop: 24, fontFamily: FONT.title, fontSize: 26, lineHeight: 31, textAlign: "center", color: T.ink, opacity: fadeLate }}>{card.reward}</Animated.Text>
        <Animated.Text style={{ marginTop: 6, fontFamily: FONT.regular, fontSize: 16, lineHeight: 22, color: T.inkSoft, textAlign: "center", opacity: fadeEarly }}>Visa koden för personalen i kassan.</Animated.Text>

        <Animated.View style={{ marginTop: 28, alignItems: "center", gap: 10, opacity: fadeEarly }}>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20, color: offline ? T.errorText : T.ink, textAlign: "center" }}>
            {offline ? "Ingen anslutning — koden gäller ändå. Försöker igen…" : "Väntar på bekräftelse"}
          </Text>
          <WaveProgress color={t.primary} width={Math.min(310, W - 64)} />
        </Animated.View>
      </View>

      <Animated.View style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, backgroundColor: T.container, opacity: fadeEarly }}>
        <Icon name="info" size={20} color={T.inkSoft} />
        <Text style={{ flex: 1, fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: T.inkSoft }}>
          Nya stämplar hos {card.name} pausas tills koden är inlöst.
        </Text>
      </Animated.View>

      {onUseStamp && (
        <Animated.View style={{ alignSelf: "stretch", marginTop: 12, opacity: fadeEarly }}>
          <Pressable onPress={dissolving ? undefined : onUseStamp} accessibilityRole="button"
            style={({ pressed }) => ({ height: 52, borderRadius: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, opacity: pressed ? 0.7 : 1 })}>
            <Icon name="nfc" size={20} color={t.primary} />
            <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: t.primary }}>Lös in med stämpeln i stället</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

// Vågig, löpande linje medan appen väntar på personalen (Material 3 Expressive).
function WaveProgress({ color, width }) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.timing(x, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    anim.start();
    return () => anim.stop();
  }, []);
  const PERIOD = 18;
  const w = width + PERIOD;
  return (
    <View style={{ width, height: 12, overflow: "hidden" }}>
      <Animated.View style={{ width: w, height: 12, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, -PERIOD] }) }] }}>
        <Svg width={w} height={12} viewBox={"0 0 " + w + " 12"}>
          <Path d={wavePath(w)} stroke={color} strokeWidth={4} strokeLinecap="round" fill="none" />
        </Svg>
      </Animated.View>
    </View>
  );
}

function wavePath(w) {
  let d = "M2 6Q6.5 1.5 11 6";
  for (let x = 20; x <= w - 2; x += 9) d += "T" + x + " 6";
  return d;
}

// En siffra i koden. När koden lösts in flyger den isär: lyfter, snurrar och
// krymper medan bläckstänk i butikens färger sprutar ut från den.
function Digit({ ch, delay, dissolving, size, box, color, splash }) {
  const p = useRef(new Animated.Value(0)).current;
  const dir = useRef({ dx: (Math.random() * 2 - 1) * 34, dy: -(24 + Math.random() * 46), rot: (Math.random() * 2 - 1) * 40 }).current;
  useEffect(() => {
    if (!dissolving) return;
    const a = Animated.timing(p, { toValue: 1, duration: 480, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [dissolving]);
  return (
    <View>
      <Animated.Text style={{
        fontFamily: FONT.display, fontSize: size, lineHeight: box, textAlign: "center", color,
        opacity: p.interpolate({ inputRange: [0, 0.3, 1], outputRange: [1, 0.9, 0] }),
        transform: [
          { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, dir.dx] }) },
          { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, dir.dy] }) },
          { rotate: p.interpolate({ inputRange: [0, 1], outputRange: ["0deg", dir.rot + "deg"] }) },
          { scale: p.interpolate({ inputRange: [0, 0.2, 1], outputRange: [1, 1.15, 0.3] }) },
        ],
      }}>{ch}</Animated.Text>
      {dissolving && <InkSplash colors={splash} count={9} radius={Math.round(size * 0.8)} delay={delay} />}
    </View>
  );
}

/* ────────────── 3. INLÖST ────────────── */
function RedeemedScreen({ card, tone: t, carry = 0, before = null, via = "code", at = null, onClose }) {
  const insets = useSafeAreaInsets();
  const pop = useRef(new Animated.Value(0)).current;
  const tick = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const needed = Math.max(1, card.needed || 1);
  // Antal på kortet när belöningen löstes in (en mindre belöning kan lösas in före fullt kort)
  const had = before == null ? needed : Math.max(0, Math.min(before, needed));
  const start = Math.max(0, Math.min(carry, had));
  const lifts = had - start;   // stämplar som lyfter från kortet
  const nextAt = ((card.tiers || [])[0] || {}).at || needed;
  const [reset, setReset] = useState(lifts === 0);

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
    Animated.spring(tick, { toValue: 1, friction: 4, tension: 110, delay: 160, useNativeDriver: true }).start();
    Animated.timing(rise, { toValue: 1, duration: 420, delay: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const timers = [setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 160)];
    if (lifts > 0) {
      timers.push(setTimeout(() => { setReset(true); Haptics.selectionAsync(); }, RESET_AT + lifts * LIFT_GAP + 260));
    }
    return () => timers.forEach(clearTimeout);
  }, []);
  const exits = Array.from({ length: lifts }, (_, k) => ({ index: had - 1 - k, delay: RESET_AT + k * LIFT_GAP }));
  const slide = (from) => ({ opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] });

  return (
    <View style={{ flex: 1, backgroundColor: T.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 16, alignItems: "center" }}>
      <Pressable accessibilityLabel="Stäng" onPress={onClose} style={{ alignSelf: "flex-end", width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" }}>
        <Icon name="close" size={24} color={T.ink} />
      </Pressable>

      <View style={{ flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 240, height: 240 }}>
          <Animated.View style={{ width: 240, height: 240, alignItems: "center", justifyContent: "center", transform: [{ scale: pop }] }}>
            <Shape kind="sunny8" size={240} color={t.container} rotate={8} style={{ position: "absolute", left: 0, top: 0 }} />
            <Shape kind="cookie12" size={180} color={t.primary}>
              <Animated.View style={{ opacity: tick, transform: [{ scale: tick.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }, { rotate: tick.interpolate({ inputRange: [0, 1], outputRange: ["-30deg", "0deg"] }) }] }}>
                <Icon name="check" size={84} color="#FFFFFF" strokeWidth={2.6} />
              </Animated.View>
            </Shape>
          </Animated.View>
          <InkSplash colors={[T.lime, t.primary, t.deco, T.lime]} count={16} radius={150} delay={120} />
        </View>

        <Animated.Text style={[{ marginTop: 28, fontFamily: FONT.title, fontSize: 45, lineHeight: 52, color: T.ink }, slide(14)]}>Inlöst!</Animated.Text>
        <Animated.Text style={[{ marginTop: 8, maxWidth: 300, fontFamily: FONT.regular, fontSize: 16, lineHeight: 24, color: T.inkSoft, textAlign: "center" }, slide(18)]}>
          {start > 0
            ? "Smaklig måltid! Ditt kort hos " + card.name + " börjar om med " + (start === 1 ? "1 stämpel" : start + " stämplar") + " som följde med."
            : "Smaklig måltid! Ditt kort hos " + card.name + " börjar om från noll."}
        </Animated.Text>

        {/* Klockslaget för inlösen — personalen ser att skärmen inte är en gammal skärmdump */}
        <Animated.View style={[{ marginTop: 14, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: T.container }, slide(22)]}>
          <LiveDot color={t.primary} />
          <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: T.ink }}>
            {(via === "tap" ? "Inlöst med stämpeln" : "Inlöst med koden") + " kl. " + clock(at || new Date())}
          </Text>
        </Animated.View>

        <Animated.View style={[{ alignSelf: "stretch", marginTop: 28, padding: 16, borderRadius: 24, backgroundColor: t.container }, slide(28)]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Shape kind="cookie9" size={36} color={t.primary}>
              <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: "#FFFFFF" }}>{initialOf(card.name)}</Text>
            </Shape>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: FONT.title, fontSize: 16, color: t.onContainer }}>{card.name}</Text>
              <Text style={{ fontFamily: FONT.regular, fontSize: 13, color: t.muted }}>Nästa belöning efter {nextAt} stämplar</Text>
            </View>
            <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: t.primary }}>{reset ? start : had}/{needed}</Text>
          </View>
          <View style={{ marginTop: 12 }}>
            {/* Kortet börjar om: stämplarna lyfter en i taget, överskottet blir kvar */}
            <StampRow total={needed} filled={had} tone={t} size={24} exits={exits} marks={(card.tiers || []).map((x) => x.at - 1)} />
          </View>
        </Animated.View>
      </View>

      <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => ({ alignSelf: "stretch", height: 56, borderRadius: 28, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>Tillbaka till korten</Text>
      </Pressable>
    </View>
  );
}

// Pulserande punkt: visar att bekräftelsen är levande (står still med "Reducera rörelse").
function LiveDot({ color }) {
  const reduce = useReduceMotion();
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) { p.setValue(0); return; }
    const a = Animated.loop(Animated.sequence([
      Animated.timing(p, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(p, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [reduce]);
  return (
    <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color,
      opacity: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }),
      transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }) }] }} />
  );
}

import React, { useEffect, useRef, useState } from "react";
import { View, Text, Modal, Pressable, Animated, Easing, Dimensions, PanResponder, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { T, FONT, tone as toneFor } from "../lib/theme";
import { Icon } from "../lib/icons";
import { saveReward, getCurrentSavedCode } from "../lib/supabase";
import Shape from "./Shape";
import StampRow from "./StampRow";
import InkSplash from "./InkSplash";

const { width: W, height: H } = Dimensions.get("window");
const initialOf = (name) => (name || "?").trim().charAt(0).toUpperCase();

/* ──────────────────────────────────────────────────────────────
   Inlösen i tre steg:
   1. Låst  — ark med förklaring + "Dra för att visa koden". Att dra sparar
              belöningen (save_reward) och ger koden.
   2. Kod   — helskärm. Personalen skriver in koden i tappass.se/m; appen pollar
              och märker när den är inlöst. Då löses siffrorna upp i partiklar.
   3. Inlöst — en stor bock; stämplarna lyfter från kortet, som börjar om på 0
              (eller på överskottet, se carryOf).
   ────────────────────────────────────────────────────────────── */

const DISSOLVE_MS = 800;   // koden löses upp innan "Inlöst!" visas
const DIGIT_GAP = 45;      // ms mellan siffrorna när de löses upp
const RESET_AT = 950;      // ms efter "Inlöst!" när stämplarna börjar lyfta
const LIFT_GAP = 70;       // ms mellan stämplarna som lyfter

// Stämplar utöver ett fullt kort följer med till nästa kort vid inlösen (v6).
// Kortet är alltid fullt innan inlösen; efteråt är plånbokens antal redan överskottet.
const carryOf = (card) => {
  const needed = Math.max(1, card?.needed || 1);
  const stamps = Math.max(0, card?.stamps || 0);
  return stamps >= needed ? stamps - needed : stamps;
};

export default function RewardSheet({ visible, card, onClose, onRedeemed }) {
  const [stage, setStage] = useState("loading"); // loading | locked | revealed | dissolve | redeemed
  const [code, setCode] = useState(null);
  const [carry, setCarry] = useState(0);         // överskottet, låst i ögonblicket koden löstes in
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

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

  // Vid öppning: hämta ev. redan sparad kod. Vid nätfel visas låst läge — att dra
  // anropar save_reward, som returnerar den sparade koden om den redan finns.
  // Beroende på slug (inte card-objektet) så att en uppdaterad plånbok inte laddar om rutan.
  useEffect(() => {
    if (!visible || !slug) return;
    let alive = true;
    setStage("loading");
    setOffline(false);
    setSaving(false);
    setSaveFailed(false);
    (async () => {
      const r = await getCurrentSavedCode(slug);
      if (!alive) return;
      if (r.ok && r.code) {
        setCode(r.code);
        setStage("revealed");
      } else {
        setStage("locked");
      }
    })();
    return () => { alive = false; };
  }, [visible, slug]);

  // Polla varannan sekund medan koden visas, för att märka när personalen löst in.
  // Bara ett säkert svar "ingen sparad kod" räknas som inlöst. Ett nätfel stänger
  // aldrig rutan — kunden ska kunna visa koden även i en kassa med dålig täckning.
  useEffect(() => {
    if (stage !== "revealed" || !slug || !visible) return;
    let alive = true;
    let timer = null;

    const check = async () => {
      const r = await getCurrentSavedCode(slug);
      if (!alive) return;
      if (!r.ok) { setOffline(true); return; }
      setOffline(false);
      if (!r.code) {
        alive = false;
        if (timer) clearInterval(timer);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setCarry(carryOf(snap.current));   // kortet före inlösen — plånboken laddas om strax
        setStage("dissolve");
        onRedeemedRef.current(slug);
      }
    };

    check();
    timer = setInterval(check, 2000);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [stage, slug, visible]);

  // Koden har lösts in: siffrorna löses upp, sedan kommer bekräftelsen.
  useEffect(() => {
    if (stage !== "dissolve") return;
    const t = setTimeout(() => setStage("redeemed"), DISSOLVE_MS);
    return () => clearTimeout(t);
  }, [stage]);

  if (!visible || !c) return null;

  const handleReveal = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaving(true);
    setSaveFailed(false);
    const result = await saveReward(c.slug);
    setSaving(false);
    if (result.ok && result.code) {
      setCode(result.code);
      setStage("revealed");
    } else {
      setSaveFailed(true);   // nätfel e.d. — kunden kan dra igen
    }
  };

  const t = toneFor(c.ink);
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {stage === "loading" || stage === "locked" ? (
        <LockedSheet card={c} tone={t} loading={stage === "loading"} saving={saving} saveFailed={saveFailed} onReveal={handleReveal} onClose={onClose} />
      ) : stage === "revealed" || stage === "dissolve" ? (
        <CodeScreen card={c} tone={t} code={code} offline={offline} dissolving={stage === "dissolve"} onClose={onClose} />
      ) : (
        <RedeemedScreen card={c} tone={t} carry={carry} onClose={onClose} />
      )}
    </Modal>
  );
}

/* ────────────── 1. LÅST — ARK MED "DRA FÖR ATT VISA KODEN" ────────────── */
function LockedSheet({ card, tone: t, loading, saving, saveFailed, onReveal, onClose }) {
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(rise, { toValue: 1, friction: 9, tension: 60, useNativeDriver: true }).start();
  }, []);
  const needed = Math.max(1, card.needed || 1);
  const carry = Math.min(carryOf(card), needed);

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
            <Text style={{ fontFamily: FONT.title, fontSize: 24, lineHeight: 30, color: T.ink }}>{card.reward}</Text>
          </View>
        </View>

        {loading ? (
          <View style={{ height: 268, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator size="large" color={t.primary} />
          </View>
        ) : (
          <View>
            <View style={{ marginTop: 20 }}>
              <StepRow tone={t} icon="phone" text="Visa koden när du står i kassan" />
              <StepRow tone={t} icon="keyboard" text="Personalen skriver in den i kassan" />
              <StepRow tone={t} icon="reset" text={"Kortet börjar om på " + carry + "/" + needed + " när koden är inlöst"} />
            </View>
            <RevealSlider tone={t} saving={saving} onReveal={onReveal} />
            <Text style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: saveFailed ? T.errorText : T.inkSoft, textAlign: "center", marginTop: 12 }}>
              {saveFailed ? "Det gick inte att hämta koden. Kontrollera nätet och dra igen." : "Koden kan bara lösas in en gång."}
            </Text>
          </View>
        )}
      </Animated.View>
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

function RevealSlider({ tone: t, saving, onReveal }) {
  const TRACK = Math.min(W, 520) - 48;   // arkets innerbredd
  const KNOB = 56;
  const MAX = TRACK - KNOB - 8;
  const dragX = useRef(new Animated.Value(0)).current;
  const savingRef = useRef(saving);
  savingRef.current = saving;
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  // Tillbaka till start när ett sparförsök är klart (lyckas det byts arket mot koden).
  useEffect(() => {
    if (!saving) Animated.spring(dragX, { toValue: 0, friction: 7, useNativeDriver: false }).start();
  }, [saving]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !savingRef.current,
      onMoveShouldSetPanResponder: () => !savingRef.current,
      onPanResponderGrant: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); },
      onPanResponderMove: (_, g) => { dragX.setValue(Math.max(0, Math.min(MAX, g.dx))); },
      onPanResponderRelease: (_, g) => {
        const x = Math.max(0, Math.min(MAX, g.dx));
        if (x >= MAX * 0.85) {
          Animated.timing(dragX, { toValue: MAX, duration: 120, useNativeDriver: false }).start(() => onRevealRef.current());
        } else {
          Animated.spring(dragX, { toValue: 0, friction: 7, useNativeDriver: false }).start();
        }
      },
      onPanResponderTerminate: () => { Animated.spring(dragX, { toValue: 0, friction: 7, useNativeDriver: false }).start(); },
    })
  ).current;

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel="Dra för att visa koden"
      accessibilityActions={[{ name: "activate", label: "Visa koden" }]}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === "activate" && !savingRef.current) onRevealRef.current(); }}
      style={{ marginTop: 22, width: TRACK, height: 64, borderRadius: 32, backgroundColor: T.container, alignItems: "center", justifyContent: "center" }}
    >
      <Animated.Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: T.inkSoft, opacity: dragX.interpolate({ inputRange: [0, MAX * 0.6], outputRange: [1, 0], extrapolate: "clamp" }) }}>
        Dra för att visa koden
      </Animated.Text>
      <View pointerEvents="none" style={{ position: "absolute", right: 20, top: 22 }}>
        <Icon name="chevrons" size={20} color="#A9AB9C" strokeWidth={2.2} />
      </View>
      <Animated.View {...responder.panHandlers} style={{ position: "absolute", left: 4, top: 4, transform: [{ translateX: dragX }] }}>
        <Shape kind="cookie9" size={KNOB} color={t.primary}>
          {saving
            ? <ActivityIndicator size="small" color="#FFFFFF" />
            : <Icon name="arrow" size={24} color="#FFFFFF" strokeWidth={2.4} />}
        </Shape>
      </Animated.View>
    </View>
  );
}

/* ────────────── 2. KODEN — HELSKÄRM ────────────── */
function CodeScreen({ card, tone: t, code, offline, dissolving, onClose }) {
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
function RedeemedScreen({ card, tone: t, carry = 0, onClose }) {
  const insets = useSafeAreaInsets();
  const pop = useRef(new Animated.Value(0)).current;
  const tick = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const needed = Math.max(1, card.needed || 1);
  const start = Math.max(0, Math.min(carry, needed));
  const lifts = needed - start;   // stämplar som lyfter från kortet
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
  const exits = Array.from({ length: lifts }, (_, k) => ({ index: needed - 1 - k, delay: RESET_AT + k * LIFT_GAP }));
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

        <Animated.View style={[{ alignSelf: "stretch", marginTop: 28, padding: 16, borderRadius: 24, backgroundColor: t.container }, slide(28)]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Shape kind="cookie9" size={36} color={t.primary}>
              <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: "#FFFFFF" }}>{initialOf(card.name)}</Text>
            </Shape>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: FONT.title, fontSize: 16, color: t.onContainer }}>{card.name}</Text>
              <Text style={{ fontFamily: FONT.regular, fontSize: 13, color: t.muted }}>Nästa belöning efter {needed} stämplar</Text>
            </View>
            <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: t.primary }}>{reset ? start : needed}/{needed}</Text>
          </View>
          <View style={{ marginTop: 12 }}>
            {/* Kortet börjar om: stämplarna lyfter en i taget, överskottet blir kvar */}
            <StampRow total={needed} filled={needed} tone={t} size={24} exits={exits} />
          </View>
        </Animated.View>
      </View>

      <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => ({ alignSelf: "stretch", height: 56, borderRadius: 28, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>Tillbaka till korten</Text>
      </Pressable>
    </View>
  );
}

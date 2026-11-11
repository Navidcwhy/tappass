import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Modal, Animated, Easing, ActivityIndicator, Dimensions, Linking, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { T, FONT, tone as toneFor } from "../lib/theme";
import { Icon } from "../lib/icons";
import { spinWheel, claimWheelPrize } from "../lib/supabase";
import { getWheelCity, setWheelCity } from "../lib/prefs";
import { restRotation, targetRotation, countdownText, expiryText, pickCity, availableIn } from "../lib/wheel";
import WheelGraphic from "./WheelGraphic";
import Shape from "./Shape";
import Confetti from "./Confetti";

const TERMS_URL = "https://tappass.se/anvandarvillkor";
const SPIN_MS = 4200;
const initialOf = (name) => (name || "?").trim().charAt(0).toUpperCase();

// Fliken "Dagens hjul". Servern avgör allt (utfall, ett snurr per dag, nästa
// snurrtid); hjulet snurrar bara till det fält servern svarade med.
export default function DailyWheel({ status, onReload, onToast, onClaimed, onCityChange, rulesVisible, onOpenRules, onCloseRules }) {
  const { width } = Dimensions.get("window");
  const size = Math.min(300, Math.max(220, width - 72));
  const rotation = useRef(new Animated.Value(restRotation(0))).current;
  const rotRef = useRef(restRotation(0));
  const seenTodayRef = useRef(undefined);   // vilket "dagens snurr" hjulet senast ställts efter
  const spunIdRef = useRef(null);           // snurret hjulet just animerat fram till
  const mounted = useRef(true);
  const [city, setCity] = useState(undefined);   // undefined = inte läst från telefonen än
  const [picker, setPicker] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [win, setWin] = useState(null);          // { spinId, offers, claimUntil }
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    mounted.current = true;
    getWheelCity().then((c) => { if (mounted.current) setCity(c); });
    if (onReload) onReload();
    return () => { mounted.current = false; };
  }, []);

  const ok = !!status && status.ok === true;
  const cities = ok && Array.isArray(status.cities) ? status.cities : [];
  const cityName = city ? pickCity(city, cities) : null;

  // Första besöket (ingen sparad stad): be om stad innan första snurret.
  useEffect(() => {
    if (city === null && ok && cities.length > 0) setPicker(true);
  }, [city, ok, cities.length]);

  // Ställ hjulet på dagens fält när serverns "dagens snurr" ändras (första
  // laddningen, ett snurr som gjordes medan fliken var stängd, ny dag) — aldrig
  // mitt i ett snurr, och inte efter ett snurr som hjulet redan animerat fram till.
  const todayKey = ok && status.today ? status.today.spin_id || "spun" : null;
  useEffect(() => {
    if (!ok || spinning) return;
    if (seenTodayRef.current === todayKey) return;
    seenTodayRef.current = todayKey;
    if (todayKey && todayKey === spunIdRef.current) return;
    const r = restRotation(status.today ? status.today.segment : 0);
    rotRef.current = r;
    rotation.setValue(r);
  }, [ok, todayKey, spinning]);

  // Nedräkningen tickar; vid midnatt hämtas nytt läge.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (ok && !status.can_spin && status.next_spin_at && Date.parse(status.next_spin_at) <= now && onReload) onReload();
  }, [now]);

  const chooseCity = (c) => {
    setPicker(false);
    setCity(c);
    setWheelCity(c);
    if (onCityChange) onCityChange(c);
    Haptics.selectionAsync();
  };

  const spin = async () => {
    if (spinning) return;
    if (!cityName) { setPicker(true); return; }
    setSpinning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const res = await spinWheel(cityName);
    // Fliken stängdes under anropet: hämta ändå läget, så att appen inte fortsätter
    // visa "Snurra" och pricken för ett snurr som redan är gjort. Vinsten finns kvar
    // som "Du har en dubbelstämpel att hämta" när fliken öppnas igen.
    if (!mounted.current) { if (onReload) onReload(); return; }
    if (!res.ok) {
      setSpinning(false);
      if (res.error === "already_spun") {
        if (onReload) onReload();
        onToast({ type: "info", title: "Du har redan snurrat i dag", subtitle: "Nästa snurr om " + countdownText(res.next_spin_at) + "." }, 3500);
      } else if (res.error === "all_bonused") {
        if (onReload) onReload();
        onToast({ type: "info", icon: "gift", title: "Du har redan dubbelstämplar i " + cityName, subtitle: "Använd en av dem, så kan du snurra igen." }, 4500);
      } else if (res.error === "no_places") {
        onToast({ type: "info", icon: "pin", title: "Inga ställen i " + cityName + " än", subtitle: "Välj en annan stad ovanför hjulet." }, 4000);
      } else if (res.error === "no_city") {
        setPicker(true);
      } else {
        // Svaret kan ha tappats efter att servern sparat snurret — stäm av läget.
        if (onReload) onReload();
        onToast({ type: "network" }, 4000);
      }
      return;
    }
    const target = targetRotation(rotRef.current, res.segment, { jitter: Math.random() * 20 - 10 });
    Animated.timing(rotation, { toValue: target, duration: SPIN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
      rotRef.current = target;
      spunIdRef.current = res.spin_id || "spun";
      if (!mounted.current) { if (onReload) onReload(); return; }
      setSpinning(false);
      if (onReload) onReload();
      if (res.won) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setWin({ spinId: res.spin_id, offers: res.offers || [], claimUntil: res.claim_until });
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToast({ type: "wheel-miss", text: "Tyvärr ingen vinst. Försök igen om " + countdownText(res.next_spin_at) + "." }, 3000);
      }
    });
  };

  // Reglerna ska gå att öppna (hjälpknappen) i alla lägen, även när hjulet laddar.
  const rules = <RulesSheet visible={!!rulesVisible} onClose={onCloseRules} />;

  if (!status) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60 }}>
        <ActivityIndicator color={T.inkMute} />
        {rules}
      </View>
    );
  }

  if (!ok) {
    return (
      <View style={{ flex: 1 }}>
        <CenterNote
          icon="wifiOff"
          title="Hjulet går inte att nå just nu"
          text="Kontrollera anslutningen och försök igen."
          action="Försök igen"
          onAction={onReload}
        />
        {rules}
      </View>
    );
  }

  const canSpin = !!status.can_spin;
  const prize = status.prize && Array.isArray(status.prize.offers) && status.prize.offers.length > 0 ? status.prize : null;
  const bonuses = Array.isArray(status.bonuses) ? status.bonuses : [];
  // Inga ställen med i hjulet (t.ex. kampanjen pausad): visa ändå oupphämtade
  // vinster och aktiva dubbelstämplar — de gäller fortfarande.
  const noCities = cities.length === 0;
  // v7: kunden har redan dubbelstämpel hos alla ställen i staden. Snurret kan inte
  // ge något att välja; det förbrukas inte och går att göra när en bonus använts.
  const blocked = canSpin && !!cityName && availableIn(cityName, cities) === 0;

  return (
    <View style={{ paddingBottom: 8 }}>
      {noCities ? (
        <CenterNote icon="wheel" title="Dagens hjul startar snart" text="Det finns inga ställen med i hjulet än." />
      ) : (
        <>
          <CityBox city={cityName} disabled={spinning} onPress={() => setPicker(true)} />

          <View style={{ alignItems: "center", marginTop: 30 }}>
            <WheelGraphic size={size} rotation={rotation} />
          </View>

          {spinning ? (
            <SpinButton label="Snurrar …" busy />
          ) : blocked ? (
            <SpinButton label="Använd en dubbelstämpel först" icon="gift" muted />
          ) : canSpin ? (
            <SpinButton label="Snurra" icon="spin" onPress={spin} />
          ) : (
            <SpinButton label={"Nästa snurr om " + countdownText(status.next_spin_at, now)} icon="timer" muted />
          )}

          <Text style={{ marginTop: 14, marginHorizontal: 8, fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: T.inkSoft, textAlign: "center" }}>
            {blocked
              ? "Du har dubbelstämplar hos alla ställen i " + cityName + ". Använd en av dem, så kan du snurra igen · "
              : canSpin ? "Gratis · 1 snurr per dag · 4 av 10 fält ger dubbelstämpel · " : "Nytt snurr varje dag kl. 00.00 · "}
            <Text accessibilityRole="link" onPress={onOpenRules} style={{ fontFamily: FONT.semibold, color: T.primary, textDecorationLine: "underline" }}>Regler</Text>
          </Text>
        </>
      )}

      {prize && !win && (
        <PrizeBanner
          prize={prize}
          now={now}
          onOpen={() => setWin({ spinId: prize.spin_id, offers: prize.offers, claimUntil: prize.claim_until })}
        />
      )}

      {bonuses.length > 0 && <BonusList bonuses={bonuses} now={now} />}

      {!noCities && <CityPicker visible={picker} cities={cities} current={cityName} onPick={chooseCity} onClose={() => setPicker(false)} />}
      <WinSheet
        win={win}
        onClose={() => {
          setWin(null);
          if (onReload) onReload();   // stäm av: ett tappat svar kan ha hämtat vinsten
        }}
        onClaimed={(cafe, expiresAt) => {
          setWin(null);
          if (onReload) onReload();
          if (onClaimed) onClaimed(cafe, expiresAt);
        }}
        onAlreadyClaimed={() => {
          setWin(null);
          if (onReload) onReload();
          if (onClaimed) onClaimed(null, null);
        }}
      />
      {rules}
    </View>
  );
}

function CenterNote({ icon, title, text, action, onAction }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 48 }}>
      <Shape kind="cookie12" size={120} color={T.container}>
        <Icon name={icon} size={40} color={T.inkSoft} strokeWidth={1.8} />
      </Shape>
      <Text style={{ marginTop: 18, fontFamily: FONT.title, fontSize: 22, lineHeight: 28, color: T.ink, textAlign: "center" }}>{title}</Text>
      <Text style={{ marginTop: 6, maxWidth: 300, fontFamily: FONT.regular, fontSize: 15, lineHeight: 22, color: T.inkSoft, textAlign: "center" }}>{text}</Text>
      {!!action && (
        <Pressable onPress={onAction} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 18, height: 48, paddingHorizontal: 22, borderRadius: 24, backgroundColor: T.secondaryContainer, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1 })}>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: T.onSecondaryContainer }}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

function CityBox({ city, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={city ? "Stad: " + city + ". Byt stad" : "Välj stad"}
      style={({ pressed }) => ({ marginTop: 14, height: 56, borderRadius: 28, borderWidth: 1, borderColor: T.outline, backgroundColor: T.surface, paddingLeft: 14, paddingRight: 16, flexDirection: "row", alignItems: "center", gap: 10, opacity: pressed ? 0.85 : 1 })}
    >
      <Icon name="pin" size={22} color={T.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.bold, fontSize: 11, letterSpacing: 0.88, color: T.inkSoft }}>DIN STAD</Text>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: T.ink }}>{city || "Välj stad"}</Text>
      </View>
      <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: T.primary }}>{city ? "Byt" : "Välj"}</Text>
      <Icon name="chevDown" size={20} color={T.primary} />
    </Pressable>
  );
}

function SpinButton({ label, icon, onPress, busy, muted }) {
  const disabled = !onPress || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: !!busy }}
      style={({ pressed }) => ({ marginTop: 30, height: 56, borderRadius: 28, backgroundColor: muted || busy ? T.container : T.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, opacity: pressed ? 0.88 : 1 })}
    >
      {busy
        ? <ActivityIndicator color={T.inkSoft} />
        : <Icon name={icon} size={20} color={muted ? T.inkSoft : "#FFFFFF"} strokeWidth={2.2} />}
      <Text style={{ fontFamily: FONT.semibold, fontSize: muted ? 16 : 17, color: muted || busy ? T.inkSoft : "#FFFFFF" }}>{label}</Text>
    </Pressable>
  );
}

function PrizeBanner({ prize, now, onOpen }) {
  return (
    <View style={{ marginTop: 20, padding: 14, borderRadius: 24, backgroundColor: T.primaryContainer, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Shape kind="burst12" size={48} color={T.primary}>
        <Text style={{ fontFamily: FONT.display, fontSize: 16, color: "#FFFFFF" }}>×2</Text>
      </Shape>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.bold, fontSize: 15, lineHeight: 20, color: T.onPrimaryContainer }}>Du har en dubbelstämpel att hämta</Text>
        <Text style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: T.inkSoft }}>Välj ställe {expiryText(prize.claim_until, now)}.</Text>
      </View>
      <Pressable onPress={onOpen} accessibilityRole="button" style={({ pressed }) => ({ height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: T.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: "#FFFFFF" }}>Välj ställe</Text>
      </Pressable>
    </View>
  );
}

function BonusList({ bonuses, now }) {
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={{ marginLeft: 4, marginBottom: 8, fontFamily: FONT.bold, fontSize: 11, letterSpacing: 0.88, color: T.inkSoft }}>DINA DUBBELSTÄMPLAR</Text>
      <View style={{ gap: 8 }}>
        {bonuses.map((b) => {
          const c = b.cafe || {};
          const t = toneFor(c.ink_color);
          return (
            <View key={c.slug} style={{ padding: 12, borderRadius: 20, backgroundColor: t.container, flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Shape kind="cookie9" size={40} color={t.primary}>
                <Text style={{ fontFamily: FONT.bold, fontSize: 16, color: "#FFFFFF" }}>{initialOf(c.name)}</Text>
              </Shape>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontFamily: FONT.title, fontSize: 16, lineHeight: 21, color: t.onContainer }}>{c.name}</Text>
                <Text style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: t.muted }}>Nästa stämpel ger 2 · {expiryText(b.expires_at, now, { short: true })}</Text>
              </View>
              <Shape kind="burst12" size={34} color={t.primary}>
                <Text style={{ fontFamily: FONT.display, fontSize: 12, color: "#FFFFFF" }}>×2</Text>
              </Shape>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Ark ────────────────────────────────────────────────────────────────

function BottomSheet({ visible, onClose, label, children }) {
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    rise.setValue(0);
    Animated.spring(rise, { toValue: 1, friction: 9, tension: 70, useNativeDriver: true }).start();
  }, [visible]);
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityLabel="Stäng" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: T.scrim }} />
        <Animated.View
          accessibilityLabel={label}
          style={{
            maxHeight: "88%", backgroundColor: T.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
            paddingHorizontal: 24, paddingTop: 10, paddingBottom: 24 + insets.bottom,
            transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [520, 0] }) }],
          }}
        >
          <View style={{ alignSelf: "center", width: 32, height: 4, borderRadius: 2, backgroundColor: T.outline }} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

function Radio({ on }) {
  return on ? (
    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: T.primary, alignItems: "center", justifyContent: "center" }}>
      <Icon name="check" size={14} color="#FFFFFF" strokeWidth={3.2} />
    </View>
  ) : (
    <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: T.inkMute }} />
  );
}

function CityPicker({ visible, cities, current, onPick, onClose }) {
  const [sel, setSel] = useState(current);
  useEffect(() => { if (visible) setSel(current || (cities[0] && cities[0].city) || null); }, [visible]);
  return (
    <BottomSheet visible={visible} onClose={onClose} label="Välj stad">
      <Shape kind="cookie9" size={64} color={T.primaryContainer} style={{ alignSelf: "center", marginTop: 18 }}>
        <Icon name="pin" size={28} color={T.primary} />
      </Shape>
      <Text accessibilityRole="header" style={{ marginTop: 14, fontFamily: FONT.title, fontSize: 26, lineHeight: 32, color: T.ink, textAlign: "center" }}>Var är du?</Text>
      <Text style={{ marginTop: 6, fontFamily: FONT.regular, fontSize: 15, lineHeight: 22, color: T.inkSoft, textAlign: "center" }}>
        Vinsterna i Dagens hjul gäller ställen i staden du väljer. Vi använder inte telefonens plats.
      </Text>
      <ScrollView style={{ marginTop: 18, flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
        {cities.map((c) => {
          const on = sel === c.city;
          return (
            <Pressable
              key={c.city}
              onPress={() => setSel(c.city)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={{ minHeight: 56, paddingHorizontal: 16, borderRadius: 16, borderWidth: on ? 2 : 1, borderColor: on ? T.primary : T.outline, backgroundColor: on ? T.secondaryContainer : T.surface, flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <Radio on={on} />
              <Text style={{ flex: 1, fontFamily: FONT.semibold, fontSize: 17, color: T.ink }}>{c.city}</Text>
              <Text style={{ fontFamily: FONT.regular, fontSize: 13, color: T.inkSoft }}>{c.places} {c.places === 1 ? "ställe" : "ställen"}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable
        onPress={() => sel && onPick(sel)}
        disabled={!sel}
        accessibilityRole="button"
        style={({ pressed }) => ({ marginTop: 20, height: 56, borderRadius: 28, backgroundColor: T.primary, alignItems: "center", justifyContent: "center", opacity: !sel ? 0.5 : pressed ? 0.88 : 1 })}
      >
        <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>Fortsätt</Text>
      </Pressable>
      <Text style={{ marginTop: 10, fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: T.inkSoft, textAlign: "center" }}>Du kan byta stad när som helst ovanför hjulet.</Text>
    </BottomSheet>
  );
}

const RULES = [
  "Gratis att delta – du behöver varken handla eller ha några stämplar.",
  "Ett snurr per dag. Nytt snurr kl. 00.00 svensk tid.",
  "Hjulet har tio fält. Fyra ger vinst – 40 % chans.",
  "Vinsten är en dubbelstämpel hos ett av tre ställen du väljer i din stad.",
  "Bonusen gäller vinstdagen och två dagar till, t.o.m. 23.59.",
  "Högst en bonus per ställe. Blir kortet fullt följer den extra stämpeln med till nästa kort.",
  "Vinster har inget kontantvärde.",
];

function RulesSheet({ visible, onClose }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} label="Regler för Dagens hjul">
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingTop: 18 }}>
        <Text accessibilityRole="header" style={{ fontFamily: FONT.title, fontSize: 24, lineHeight: 30, color: T.ink }}>Regler för Dagens hjul</Text>
        <View style={{ marginTop: 16, gap: 12 }}>
          {RULES.map((r) => (
            <View key={r} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <Shape kind="cookie9" size={14} color={T.primary} style={{ marginTop: 4 }} />
              <Text style={{ flex: 1, fontFamily: FONT.regular, fontSize: 15, lineHeight: 22, color: T.ink }}>{r}</Text>
            </View>
          ))}
        </View>
        <View style={{ marginTop: 18, padding: 14, borderRadius: 12, backgroundColor: T.container }}>
          <Text style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 19, color: T.inkSoft }}>
            Dagens hjul anordnas av Folde.AI AB. Apple och Google är inte sponsorer och är inte inblandade på något sätt.
          </Text>
        </View>
        <Pressable onPress={() => Linking.openURL(TERMS_URL).catch(() => {})} accessibilityRole="link" style={{ marginTop: 10, minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: T.primary }}>Fullständiga villkor</Text>
          <Icon name="external" size={16} color={T.primary} />
        </Pressable>
      </ScrollView>
      <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 10, height: 56, borderRadius: 28, backgroundColor: T.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>Stäng</Text>
      </Pressable>
    </BottomSheet>
  );
}

// Vinst: konfetti + välj 1 av 3 ställen. Stängs arket utan val ligger vinsten
// kvar och kan hämtas från fliken fram till sista giltiga dag.
function WinSheet({ win, onClose, onClaimed, onAlreadyClaimed }) {
  const insets = useSafeAreaInsets();
  const pop = useRef(new Animated.Value(0)).current;
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!win) return;
    setPicked(win.offers[0] && win.offers[0].cafe ? win.offers[0].cafe.slug : null);
    setErr("");
    setBusy(false);
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 50, useNativeDriver: true }).start();
  }, [win]);

  if (!win) return null;
  const offers = (win.offers || []).filter((o) => o && o.cafe);
  const chosen = offers.find((o) => o.cafe.slug === picked);

  const claim = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    setErr("");
    const r = await claimWheelPrize(win.spinId, chosen.cafe.slug);
    setBusy(false);
    if (r.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClaimed(r.cafe || chosen.cafe, r.expires_at);
      return;
    }
    if (r.error === "already_claimed") {
      // Vinsten är redan hämtad — t.ex. när svaret på förra försöket tappades men
      // servern sparade valet. Stäng och visa kortet i stället för ett felmeddelande.
      onAlreadyClaimed();
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (r.error === "bonus_exists") setErr("Du har redan en dubbelstämpel hos " + chosen.cafe.name + ". Välj ett annat ställe.");
    else if (r.error === "expired") setErr("Vinsten har tyvärr gått ut.");
    else if (r.error === "not_offered") setErr("Det stället går inte att välja längre. Välj ett annat.");
    else setErr("Ingen anslutning just nu. Försök igen.");
  };

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: T.primaryContainer, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20, paddingHorizontal: 16 }}>
        <Confetti count={28} colors={[T.primary, "#CBDB98", "#FFFFFF", T.lime, "#1B6371"]} />
        <Pressable accessibilityLabel="Stäng" onPress={onClose} style={{ alignSelf: "flex-end", width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" }}>
          <Icon name="close" size={24} color={T.onPrimaryContainer} />
        </Pressable>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: "stretch", paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          <Animated.View style={{ alignSelf: "center", transform: [{ scale: pop }, { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ["-30deg", "0deg"] }) }] }}>
            <Shape kind="burst12" size={128} color={T.primary}>
              <Text style={{ fontFamily: FONT.display, fontSize: 46, color: "#FFFFFF" }}>×2</Text>
            </Shape>
          </Animated.View>
          <Text accessibilityRole="header" style={{ marginTop: 16, fontFamily: FONT.title, fontSize: 30, lineHeight: 36, color: T.onPrimaryContainer, textAlign: "center" }}>Grattis! Dubbelstämpel</Text>
          <Text style={{ marginTop: 6, fontFamily: FONT.regular, fontSize: 15, lineHeight: 22, color: "#3B4622", textAlign: "center" }}>
            Välj var du vill använda den.{"\n"}Gäller {expiryText(win.claimUntil)}.
          </Text>

          <View accessibilityRole="radiogroup" style={{ marginTop: 20, gap: 10 }}>
            {offers.map((o) => (
              <OfferCard key={o.cafe.slug} offer={o} on={picked === o.cafe.slug} onPress={() => { setPicked(o.cafe.slug); setErr(""); Haptics.selectionAsync(); }} />
            ))}
          </View>
          {!!err && <Text accessibilityLiveRegion="polite" style={{ marginTop: 12, fontFamily: FONT.medium, fontSize: 14, lineHeight: 20, color: T.errorText, textAlign: "center" }}>{err}</Text>}
        </ScrollView>

        <Pressable
          onPress={claim}
          disabled={!chosen || busy}
          accessibilityRole="button"
          style={({ pressed }) => ({ height: 56, borderRadius: 28, backgroundColor: T.primary, alignItems: "center", justifyContent: "center", opacity: !chosen ? 0.5 : pressed ? 0.88 : 1 })}
        >
          {busy
            ? <ActivityIndicator color="#FFFFFF" />
            : <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>{chosen ? "Använd hos " + chosen.cafe.name : "Välj ett ställe"}</Text>}
        </Pressable>
        <Text style={{ marginTop: 10, fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: "#3B4622", textAlign: "center" }}>Bonusen läggs på din nästa stämpling där.</Text>
      </View>
    </Modal>
  );
}

function OfferCard({ offer, on, onPress }) {
  const c = offer.cafe;
  const t = toneFor(c.ink_color);
  const meta = [c.type, c.area].filter(Boolean).join(" · ");
  const chip = offer.is_new ? "Nytt för dig" : (offer.stamps || 0) + "/" + (c.stamps_needed || 0);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={c.name + ", " + chip}
      style={({ pressed }) => ({ minHeight: 76, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 20, borderWidth: 2, borderColor: on ? T.primary : "transparent", backgroundColor: T.surface, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.92 : 1 })}
    >
      <Shape kind="cookie9" size={44} color={t.primary}>
        <Text style={{ fontFamily: FONT.bold, fontSize: 18, color: "#FFFFFF" }}>{initialOf(c.name)}</Text>
      </Shape>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: FONT.title, fontSize: 17, lineHeight: 22, color: T.ink }}>{c.name}</Text>
        {!!meta && <Text numberOfLines={1} style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: T.inkSoft }}>{meta}</Text>}
      </View>
      <View style={{ height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: offer.is_new ? T.tertiaryContainer : t.container, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: FONT.bold, fontSize: 12, color: offer.is_new ? T.onTertiaryContainer : t.onContainer }}>{chip}</Text>
      </View>
      <Radio on={on} />
    </Pressable>
  );
}

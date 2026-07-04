import "react-native-url-polyfill/auto";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, Pressable, ScrollView, StatusBar, Animated, Easing, ActivityIndicator, RefreshControl, Platform } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as Font from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { T, RADIUS, FONT, FONTS_URL } from "./src/lib/theme";
import { Icon, CafeIcon } from "./src/lib/icons";
import { useNfcStatus } from "./src/lib/useNfcStatus";
import { initNfc, readToken, cancelNfc, setIosAlert, isCancelOrTimeout } from "./src/lib/nfc";
import { tapToken, saveReward, redeemReward, loadWallet, loadCafes } from "./src/lib/supabase";
import { hasOnboarded, markOnboarded } from "./src/lib/prefs";
import LoyaltyCard from "./src/components/LoyaltyCard";
import RewardSheet from "./src/components/RewardSheet";
import CelebrationScreen from "./src/components/CelebrationScreen";
import AppLinkOnboarding from "./src/components/AppLinkOnboarding";

SplashScreen.preventAutoHideAsync().catch(() => {});

// Normalize a cafe row from Supabase (ink_color, soft_color, deep_color)
// into the shape components expect (ink, soft, deep, etc.)
function normalizeCafe(c) {
  if (!c) return null;
  return {
    id: c.slug,
    slug: c.slug,
    name: c.name,
    type: c.type,
    area: c.area,
    symbol: c.symbol,
    ink: c.ink_color,
    soft: c.soft_color,
    deep: c.deep_color,
    reward: c.reward_text,
    rewardShort: c.reward_short,
    needed: c.stamps_needed,
  };
}

function normalizeCard({ cafe, stamps, pending }) {
  return {
    ...normalizeCafe(cafe),
    stamps,
    times: [],                // we don't render exact times anymore — saved server-side
    pendingReward: !!pending,
  };
}

function tokenFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = Linking.parse(url);
    const path = (parsed.path || "").replace(/^\/+/, "");
    const m = path.match(/^t\/([a-z0-9_-]+)/i);
    return m ? m[1].toLowerCase() : null;
  } catch { return null; }
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [wallet, setWallet] = useState({});      // slug -> card
  const [allCafes, setAllCafes] = useState([]);  // for discover tab + simulate
  const [tab, setTab] = useState("home");
  const [rewardId, setRewardId] = useState(null);
  const [celebrationId, setCelebrationId] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [toast, setToast] = useState(null);
  const [loadingAction, setLoadingAction] = useState(false);
  const walletRef = useRef(wallet);
  useEffect(() => { walletRef.current = wallet; }, [wallet]);

  const nfc = useNfcStatus();

  // Initial load: fonts, NFC, cafes, wallet
  useEffect(() => {
    (async () => {
      try { await Font.loadAsync(FONTS_URL); } catch {}
      await initNfc();
      const [cafes, walletRows] = await Promise.all([loadCafes(), loadWallet()]);
      setAllCafes(cafes.map(normalizeCafe));
      const w = {};
      walletRows.forEach((row) => { const card = normalizeCard(row); w[card.slug] = card; });
      setWallet(w);
      setReady(true);
      // Show the intro only on the first launch, not on every start.
      if (!(await hasOnboarded())) setTimeout(() => setShowOnboarding(true), 1500);
    })();
  }, []);

  const closeOnboarding = useCallback(() => { setShowOnboarding(false); markOnboarded(); }, []);

  const onLayoutReady = useCallback(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);

  // Refresh wallet from backend (after any action that may have changed state)
  const refreshWallet = useCallback(async () => {
    const rows = await loadWallet();
    const w = {};
    rows.forEach((row) => { const card = normalizeCard(row); w[card.slug] = card; });
    setWallet(w);
  }, []);

  // Send a tap to backend by token (e.g. "miyabi-01" or "bryggan-01")
  const sendTap = useCallback(async (token) => {
    const result = await tapToken(token);
    if (!result.ok && result.error === "pending_reward") {
      const cafe = normalizeCafe(result.cafe);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setToast({ type: "pending-block", card: cafe });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    if (!result.ok) {
      setToast({ type: "error", message: "Okänd tagg: " + token });
      setTimeout(() => setToast(null), 2000);
      return;
    }

    const card = normalizeCard({ cafe: result.cafe, stamps: result.stamps, pending: false });
    setWallet((prev) => ({ ...prev, [card.slug]: card }));

    if (result.complete) {
      setTimeout(() => setCelebrationId(card.slug), 700);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setToast({ type: "stamped", card });
      setTimeout(() => setToast(null), 2400);
    }
  }, []);

  // Tag is tapped via NFC deep-link (https://tappass.se/t/<token>) or local simulate
  const handleUrl = useCallback((url) => {
    const token = tokenFromUrl(url);
    if (!token) return;
    sendTap(token);
    setTab("home");
  }, [sendTap]);

  useEffect(() => {
    Linking.getInitialURL().then((url) => { if (url) handleUrl(url); });
    const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));
    return () => sub.remove();
  }, [handleUrl]);

  if (!ready) return null;

  const cards = Object.values(wallet);
  const pendingCards = cards.filter((c) => c.pendingReward);
  const progressCards = cards.filter((c) => !c.pendingReward && c.stamps < c.needed);
  const discover = allCafes.filter((b) => !wallet[b.slug]);
  const totalStamps = cards.reduce((s, c) => s + c.stamps, 0);

  const onSaveReward = async () => {
    setLoadingAction(true);
    await saveReward(celebrationId);
    await refreshWallet();
    setLoadingAction(false);
    setCelebrationId(null);
  };
  const onRedeemNow = () => {
    setRewardId(celebrationId);
    setCelebrationId(null);
  };
  const onRedeemed = async (slug) => {
    setLoadingAction(true);
    await redeemReward(slug);
    await refreshWallet();
    setLoadingAction(false);
    setRewardId(null);
  };

  // Simulate row passes cafe — we resolve to its first token by slug pattern
  const simulateStamp = (cafe) => sendTap(cafe.slug + "-01");

  const rewardCard = rewardId ? wallet[rewardId] : null;
  const celebrationCard = celebrationId ? wallet[celebrationId] : null;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={T.bg} />
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: T.bg }} onLayout={onLayoutReady}>
        <Header onSettings={() => setShowOnboarding(true)} loading={loadingAction} />

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 130 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refreshWallet} tintColor={T.inkMute} />}
        >
          {tab === "home" && (
            <HomeWithScanner
              nfc={nfc}
              pendingCards={pendingCards}
              progressCards={progressCards}
              totalStamps={totalStamps}
              onSimulate={simulateStamp}
              onSendTap={sendTap}
              onOpenReward={setRewardId}
              hasCards={cards.length > 0}
              cafes={allCafes}
            />
          )}
          {tab === "discover" && <DiscoverTab places={discover} />}
        </ScrollView>

        <BottomNav tab={tab} setTab={setTab} />
        <Toast toast={toast} />

        <RewardSheet visible={!!rewardCard} card={rewardCard} onClose={() => setRewardId(null)} onRedeemed={onRedeemed} />
        <CelebrationScreen visible={!!celebrationCard} card={celebrationCard} onSave={onSaveReward} onRedeemNow={onRedeemNow} />
        <AppLinkOnboarding visible={showOnboarding} onClose={closeOnboarding} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Header({ onSettings, loading }) {
  return (
    <View style={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontFamily: FONT.display, fontSize: 24, color: T.ink }}>TapPass</Text>
        {loading && <ActivityIndicator size="small" color={T.inkMute} />}
      </View>
      <Pressable onPress={onSettings} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: T.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: T.hairline }}>
        <Icon name="sparkles" size={18} color={T.inkSoft} />
      </Pressable>
    </View>
  );
}

function HomeWithScanner({ nfc, pendingCards, progressCards, totalStamps, onSimulate, onSendTap, onOpenReward, hasCards, cafes }) {
  const cardCount = pendingCards.length + progressCards.length;

  return (
    <View>
      <LiveScanner nfc={nfc} onSendTap={onSendTap} />

      {!hasCards && (
        <View style={{ paddingTop: 8 }}>
          <Text style={{ fontFamily: FONT.uiMed, fontSize: 11, color: T.inkMute, letterSpacing: 1.6 }}>VÄLKOMMEN</Text>
          <Text style={{ fontFamily: FONT.display, fontSize: 36, color: T.ink, lineHeight: 40, marginTop: 6 }}>
            Tappa en TapPass-stämpel för att börja samla.
          </Text>
          <Text style={{ fontFamily: FONT.ui, fontSize: 14, color: T.inkSoft, marginTop: 12, lineHeight: 20 }}>
            Nedan kan du simulera en disk för att testa flödet.
          </Text>
          <SimulateRow cafes={cafes} onSimulate={onSimulate} />
        </View>
      )}

      {hasCards && (
        <View style={{ paddingTop: 14, paddingBottom: 24, flexDirection: "row", gap: 18 }}>
          <Stat label="Aktiva kort" value={cardCount} />
          <View style={{ width: 1, backgroundColor: T.hairline }} />
          <Stat label="Stämplar totalt" value={totalStamps} />
          <View style={{ width: 1, backgroundColor: T.hairline }} />
          <Stat label="Sparade belöningar" value={pendingCards.length} accent={pendingCards.length > 0} />
        </View>
      )}

      {pendingCards.length > 0 && (
        <View style={{ marginBottom: 22 }}>
          <SectionLabel text="Sparade belöningar" />
          <View style={{ gap: 14, marginTop: 12 }}>
            {pendingCards.map((c) => <LoyaltyCard key={c.slug} card={c} onOpenReward={onOpenReward} />)}
          </View>
        </View>
      )}

      {progressCards.length > 0 && (
        <View>
          <SectionLabel text="Pågående kort" />
          <View style={{ gap: 14, marginTop: 12 }}>
            {progressCards.map((c) => <LoyaltyCard key={c.slug} card={c} onOpenReward={onOpenReward} />)}
          </View>
        </View>
      )}

      {hasCards && (
        <View style={{ marginTop: 30 }}>
          <Text style={{ fontFamily: FONT.uiMed, fontSize: 10, color: T.inkFaint, letterSpacing: 1.4, textAlign: "center", marginBottom: 12 }}>SIMULERA EN DISK</Text>
          <SimulateRow cafes={cafes} onSimulate={onSimulate} compact />
        </View>
      )}
    </View>
  );
}

// iOS Core NFC has no silent foreground reading: every requestTechnology call
// shows the system "Ready to Scan" sheet, so a background loop is impossible.
// Platform-branch: Android keeps the passive loop, iOS uses a button that runs
// exactly one scan session per tap.
function LiveScanner({ nfc, onSendTap }) {
  return Platform.OS === "ios"
    ? <IosScanner nfc={nfc} onSendTap={onSendTap} />
    : <AndroidScanner nfc={nfc} onSendTap={onSendTap} />;
}

// Token can be either a slug ("miyabi") or a full token ("miyabi-01").
// Backend handles both, but our DB uses "<slug>-01" format.
function normalizeToken(token) {
  return token.includes("-") ? token : token + "-01";
}

function AndroidScanner({ nfc, onSendTap }) {
  const [err, setErr] = useState("");
  const mountedRef = useRef(true);
  const loopGuardRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; cancelNfc(); };
  }, []);

  useEffect(() => {
    if (!nfc.enabled) { cancelNfc(); return; }
    let cancelled = false;
    const loop = async () => {
      if (cancelled || !mountedRef.current) return;
      setErr("");
      try {
        const token = await readToken();
        if (cancelled || !mountedRef.current) return;
        if (token) await onSendTap(normalizeToken(token));
      } catch (e) {
        if (!isCancelOrTimeout(e)) setErr("Läsfel — håll stilla nästa gång.");
      } finally {
        await cancelNfc();
        if (!cancelled && mountedRef.current) {
          loopGuardRef.current += 1;
          const delay = loopGuardRef.current > 10 ? 1500 : 400;
          setTimeout(() => { loopGuardRef.current = Math.max(0, loopGuardRef.current - 1); loop(); }, delay);
        }
      }
    };
    loop();
    return () => { cancelled = true; cancelNfc(); };
  }, [nfc.enabled, onSendTap]);

  return (
    <View style={{ paddingTop: 18, paddingBottom: 24, alignItems: "center" }}>
      <Radar enabled={!!nfc.enabled} />
      <Text style={{ fontFamily: FONT.display, fontSize: 26, color: T.ink, marginTop: 18, textAlign: "center" }}>
        {nfc.supported === false ? "NFC stöds inte" : nfc.enabled ? "Håll mot taggen" : "Slå på NFC"}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: nfc.enabled ? T.ok : T.inkFaint }} />
        <Text style={{ fontFamily: FONT.uiMed, fontSize: 12, color: T.inkMute }}>
          {nfc.supported === null ? "Kontrollerar…" : nfc.enabled ? "Lyssnar nu" : "NFC är avstängt"}
        </Text>
      </View>
      {!!err && <Text style={{ fontFamily: FONT.ui, fontSize: 12, color: T.warn, marginTop: 6 }}>{err}</Text>}
    </View>
  );
}

function IosScanner({ nfc, onSendTap }) {
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState("");
  const scanningRef = useRef(false);

  useEffect(() => () => { cancelNfc(); }, []);

  const onScan = async () => {
    if (scanningRef.current || nfc.supported === false) return;
    scanningRef.current = true;
    setScanning(true);
    setErr("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const token = await readToken({ alertMessage: "Håll toppen av iPhonen mot TapPass-stämpeln" });
      if (token) {
        await setIosAlert("Stämpel läst");
        await cancelNfc();
        await onSendTap(normalizeToken(token));
      } else {
        await cancelNfc();
        setErr("Ingen TapPass-tagg hittades. Försök igen.");
      }
    } catch (e) {
      await cancelNfc();
      if (!isCancelOrTimeout(e)) setErr("Läsfel — försök igen.");
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  };

  const unsupported = nfc.supported === false;

  return (
    <View style={{ paddingTop: 18, paddingBottom: 24, alignItems: "center" }}>
      <Radar enabled={scanning} />
      <Text style={{ fontFamily: FONT.display, fontSize: 26, color: T.ink, marginTop: 18, textAlign: "center" }}>
        {unsupported ? "NFC stöds inte" : scanning ? "Skannar…" : "Skanna en stämpel"}
      </Text>
      <Text style={{ fontFamily: FONT.ui, fontSize: 13, color: T.inkMute, marginTop: 6, textAlign: "center", maxWidth: 280, lineHeight: 19 }}>
        {unsupported
          ? "Den här enheten saknar NFC-läsare."
          : "Tryck på knappen och håll toppen av telefonen mot stämpeln i kassan."}
      </Text>

      {!unsupported && (
        <Pressable
          onPress={onScan}
          disabled={scanning}
          style={({ pressed }) => ({
            marginTop: 22,
            backgroundColor: T.ink,
            paddingHorizontal: 26,
            paddingVertical: 15,
            borderRadius: RADIUS.pill,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            opacity: scanning ? 0.6 : pressed ? 0.85 : 1,
          })}
        >
          {scanning
            ? <ActivityIndicator size="small" color="#fff" />
            : <Icon name="scan" size={20} color="#fff" strokeWidth={2} />}
          <Text style={{ fontFamily: FONT.uiBold, fontSize: 15, color: "#fff", letterSpacing: 0.3 }}>
            {scanning ? "Håll mot taggen…" : "Skanna stämpel"}
          </Text>
        </Pressable>
      )}

      {!!err && <Text style={{ fontFamily: FONT.ui, fontSize: 12, color: T.warn, marginTop: 12, textAlign: "center" }}>{err}</Text>}
    </View>
  );
}

function Radar({ enabled }) {
  const wave = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) { wave.forEach((v) => v.stopAnimation()); float.stopAnimation(); return; }
    wave.forEach((v, i) => {
      Animated.loop(Animated.sequence([
        Animated.delay(i * 800),
        Animated.timing(v, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])).start();
    });
    Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: -8, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])).start();
  }, [enabled]);

  return (
    <View style={{ height: 144, alignItems: "center", justifyContent: "center" }}>
      {enabled && wave.map((v, i) => (
        <Animated.View key={i} style={{ position: "absolute", width: 140, height: 140, borderRadius: 70, borderWidth: 1.5, borderColor: T.accent, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.5] }) }] }} />
      ))}
      <Animated.View style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: enabled ? T.accent : T.bgAlt, borderWidth: enabled ? 0 : 1, borderColor: T.hairline, alignItems: "center", justifyContent: "center", transform: [{ translateY: enabled ? float : 0 }], shadowColor: enabled ? T.accentDark : "transparent", shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: enabled ? 8 : 0 }}>
        <Icon name={enabled ? "scan" : "wifi"} size={36} color={enabled ? T.accentInk : T.inkFaint} strokeWidth={2} />
      </Animated.View>
    </View>
  );
}

function SimulateRow({ cafes, onSimulate, compact }) {
  return (
    <View style={{ marginTop: compact ? 0 : 22, flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
      {cafes.map((b) => (
        <Pressable key={b.slug} onPress={() => onSimulate(b)} style={{ width: 96, paddingVertical: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: T.hairline, backgroundColor: T.surface, alignItems: "center", gap: 6 }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: b.soft, alignItems: "center", justifyContent: "center" }}>
            <CafeIcon symbol={b.symbol} size={17} color={b.ink} strokeWidth={1.6} />
          </View>
          <Text style={{ fontFamily: FONT.uiMed, fontSize: 10.5, color: T.ink, textAlign: "center" }}>{b.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Toast({ toast }) {
  const y = useRef(new Animated.Value(80)).current;
  useEffect(() => {
    if (!toast) { Animated.timing(y, { toValue: 80, duration: 200, useNativeDriver: true }).start(); return; }
    Animated.spring(y, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }).start();
  }, [toast]);
  if (!toast) return null;

  const isBlock = toast.type === "pending-block";
  const isError = toast.type === "error";
  const bg = isBlock ? T.warn : isError ? T.err : T.ink;

  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: 22, right: 22, bottom: 100, transform: [{ translateY: y }] }}>
      <View style={{ backgroundColor: bg, borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 12, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10 }}>
        <Icon name={isBlock ? "gift" : isError ? "close" : "check"} size={20} color="#fff" strokeWidth={2.2} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONT.uiBold, fontSize: 13, color: "#fff" }}>
            {isBlock ? "Lös in din sparade belöning först" : isError ? toast.message : toast.card.name + " · +1 stämpel"}
          </Text>
          {!isError && (
            <Text style={{ fontFamily: FONT.ui, fontSize: 11.5, color: "rgba(255,255,255,.75)", marginTop: 1 }}>
              {isBlock ? "Tappar pausade tills belöningen är inlöst" : toast.card.stamps + " av " + toast.card.needed + " stämplar"}
            </Text>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

function DiscoverTab({ places }) {
  return (
    <View style={{ paddingTop: 18 }}>
      <Text style={{ fontFamily: FONT.uiMed, fontSize: 11, color: T.inkMute, letterSpacing: 1.6 }}>UPPTÄCK</Text>
      <Text style={{ fontFamily: FONT.display, fontSize: 42, color: T.ink, lineHeight: 46, marginTop: 6 }}>Nya ställen</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16, marginBottom: 18 }}>
        <Icon name="pin" size={13} color={T.inkMute} />
        <Text style={{ fontFamily: FONT.ui, fontSize: 12.5, color: T.inkMute }}>Anslutna butiker du inte besökt än</Text>
      </View>
      {places.length === 0 && (
        <Text style={{ fontFamily: FONT.ui, fontSize: 13, color: T.inkMute, marginTop: 20 }}>
          Du har stämplat hos alla anslutna butiker. Bra jobbat.
        </Text>
      )}
      <View style={{ gap: 12 }}>
        {places.map((b) => (
          <View key={b.slug} style={{ backgroundColor: T.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: T.hairline, padding: 18, flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: b.soft, alignItems: "center", justifyContent: "center" }}>
              <CafeIcon symbol={b.symbol} size={22} color={b.ink} strokeWidth={1.6} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FONT.display, fontSize: 19, color: T.ink, lineHeight: 22 }}>{b.name}</Text>
              <Text style={{ fontFamily: FONT.ui, fontSize: 12.5, color: T.inkMute, marginTop: 1 }}>{b.type} · {b.area}</Text>
              <Text style={{ fontFamily: FONT.ui, fontSize: 13, color: b.ink, marginTop: 4 }}>{b.rewardShort}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function Stat({ label, value, accent }) {
  return (
    <View>
      <Text style={{ fontFamily: FONT.uiMed, fontSize: 10, color: T.inkMute, letterSpacing: 1.4 }}>{label.toUpperCase()}</Text>
      <Text style={{ fontFamily: FONT.display, fontSize: 26, color: accent ? T.accentDark : T.ink, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function SectionLabel({ text }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={{ fontFamily: FONT.uiBold, fontSize: 10, color: T.inkMute, letterSpacing: 1.6 }}>{text.toUpperCase()}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: T.hairline }} />
    </View>
  );
}

function BottomNav({ tab, setTab }) {
  const Item = ({ k, label, icon }) => {
    const on = tab === k;
    return (
      <Pressable onPress={() => setTab(k)} style={{ flex: 1, paddingVertical: 12, alignItems: "center", gap: 4 }}>
        <Icon name={icon} size={22} color={on ? "#fff" : "rgba(255,255,255,.5)"} strokeWidth={on ? 2 : 1.6} />
        <Text style={{ fontFamily: FONT.uiMed, fontSize: 10.5, color: on ? "#fff" : "rgba(255,255,255,.5)", letterSpacing: 0.3 }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 22, alignItems: "center" }}>
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: T.ink, borderRadius: 30, paddingHorizontal: 8, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 12, minWidth: 220 }}>
        <Item k="home" label="Hem" icon="home" />
        <Item k="discover" label="Ställen" icon="compass" />
      </View>
    </View>
  );
}

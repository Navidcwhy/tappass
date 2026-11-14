import "react-native-url-polyfill/auto";
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { View, Text, Pressable, ScrollView, Animated, Dimensions, StatusBar, ActivityIndicator, RefreshControl, Platform, TextInput, Share, AppState, Linking as RNLinking } from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Font from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { T, FONT, FONT_FILES, tone as toneFor } from "./src/lib/theme";
import { Icon } from "./src/lib/icons";
import { useNfcStatus } from "./src/lib/useNfcStatus";
import { initNfc, readToken, cancelNfc, setIosAlert, isCancelOrTimeout } from "./src/lib/nfc";
import { splitTag, sunFromQuery } from "./src/lib/tagurl";
import { tapToken, saveReward, loadWallet, loadCafes, wheelStatus, getAuthMethods, accountStatus, newDeviceId, birthdayStatus, inviteStatus, ackInvites } from "./src/lib/supabase";
import { hasOnboarded, markOnboarded, getWheelCity, hasFirstStamp, markFirstStamp, getAccount, setAccount, clearAccount, accountHintDismissed, dismissAccountHint, inviteHintDismissed, dismissInviteHint } from "./src/lib/prefs";
import { readCache, writeCache } from "./src/lib/cache";
import { expiryText, isActiveUntil, availableIn } from "./src/lib/wheel";
import CardStack from "./src/components/CardStack";
import SeasonFall from "./src/components/SeasonFall";
import Confetti from "./src/components/Confetti";
import useReduceMotion from "./src/lib/useReduceMotion";
import { seasonFor } from "./src/lib/season";
import { quietNow, quietParts, quietSummary } from "./src/lib/quiet";
import { cleanTiers, crossedTier, krValue } from "./src/lib/tiers";
import { savingsFields, keepSavings, walletSavings } from "./src/lib/savings";
import { visitsFields, afterTap, crossedLevel, levelFor, progressText } from "./src/lib/levels";
import RewardSheet from "./src/components/RewardSheet";
import PlaceSheet from "./src/components/PlaceSheet";
import CafeAvatar from "./src/components/CafeAvatar";
import { openState, openText } from "./src/lib/hours";
import SavingsBanner from "./src/components/SavingsBanner";
import CelebrationScreen from "./src/components/CelebrationScreen";
import AppLinkOnboarding from "./src/components/AppLinkOnboarding";
import AccountSheet from "./src/components/AccountSheet";
import BirthdaySheet, { PINK } from "./src/components/BirthdaySheet";
import { bannerText } from "./src/lib/birthday";
import InviteSheet from "./src/components/InviteSheet";
import { INVITE_STAMPS, unseenText } from "./src/lib/invite";
import StampSheet from "./src/components/StampSheet";
import Snackbar from "./src/components/Snackbar";
import Shape from "./src/components/Shape";
import DailyWheel from "./src/components/DailyWheel";
import RadarBadge from "./src/components/RadarBadge";

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
    quietHours: Array.isArray(c.quiet_hours) ? c.quiet_hours : [],   // v8: lugna timmar
    tiers: cleanTiers(c.reward_tiers, c.stamps_needed),               // v10: mindre belöningar
    rewardValue: krValue(c.reward_value_kr),                          // v10: huvudbelöningens värde (kr)
    // v13: profilen som butiken själv fyller i
    address: c.address || "",
    description: c.description || "",
    website: c.website || "",
    instagram: c.instagram || "",
    openingHours: Array.isArray(c.opening_hours) ? c.opening_hours : [],
    logoVersion: Number(c.logo_version) || 0,
    birthdayText: c.birthday_text || "",                              // v15: födelsedagspresent (tom = erbjuds inte)
    birthdayValue: krValue(c.birthday_value_kr),
  };
}

function normalizeCard(row) {
  const { cafe, stamps, pending, pending_tier, pending_reward, bonus_expires_at } = row;
  return {
    ...normalizeCafe(cafe),
    stamps,
    times: [],                // we don't render exact times anymore — saved server-side
    pendingReward: !!pending,
    pendingTier: pending && pending_tier != null ? Number(pending_tier) : null,   // v10: vilken belöning som är sparad
    pendingName: pending && pending_reward ? String(pending_reward) : null,       // v10: dess namn när den sparades
    bonusExpiresAt: bonus_expires_at || null,   // Dagens hjul: aktiv dubbelstämpel
    ...savingsFields(row),    // v10: sparat-räknaren (inlösta belöningar och deras värde)
    ...visitsFields(row),     // v11: besök senaste 12 månaderna → stamgästnivå
  };
}

function walletFromRows(rows) {
  const w = {};
  rows.forEach((row) => { const card = normalizeCard(row); w[card.slug] = card; });
  return w;
}

// Upper bound for the local-only startup work (bundled fonts, native NFC start,
// AsyncStorage). Network is never part of it.
const LOCAL_BOOT_CAP_MS = 2000;

// https://tappass.se/t/<token>, tappass:///t/<token> och tappass://t/<token> → { token, sun }.
// I den sista formen tolkas "t" som värdnamn och sökvägen blir bara token —
// tappass.se/t/… länkar dit från "Jag har redan appen" på iPhone. En dynamisk tagg (v17)
// lägger till ?e=…&c=… (SUN), som följer med till servern.
export function tagFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = Linking.parse(url);
    let path = (parsed.path || "").replace(/^\/+/, "");
    const scheme = String(parsed.scheme || "").toLowerCase();
    if (parsed.hostname === "t" && scheme !== "http" && scheme !== "https") path = "t/" + path;
    const m = path.match(/^t\/([a-z0-9_-]+)/i);
    if (!m) return null;
    const plain = String(url).split("#")[0];
    const q = plain.indexOf("?");
    return { token: m[1].toLowerCase(), sun: q < 0 ? null : sunFromQuery(plain.slice(q + 1)) };
  } catch { return null; }
}

export function tokenFromUrl(url) {
  const tag = tagFromUrl(url);
  return tag ? tag.token : null;
}

// Stämpling från en tagg ({ token, sun }), en länk eller dev-simuleringen ("miyabi-01")
const asTag = (input) => (input && typeof input === "object" ? input : splitTag(input));


export default function App() {
  const [ready, setReady] = useState(false);
  const [synced, setSynced] = useState(false);   // first backend refresh finished (ok or failed)
  const [fontEpoch, setFontEpoch] = useState(0);
  const syncedRef = useRef(false);
  const [wallet, setWallet] = useState({});      // slug -> card
  const [allCafes, setAllCafes] = useState([]);  // for places tab + simulate
  const [tab, setTab] = useState("home");
  const [filter, setFilter] = useState("all");   // all | ready
  // Huvudlistans skrollning driver kortbuntens djup och glans (native-tråden).
  const scrollY = useRef(new Animated.Value(0)).current;
  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }), [scrollY]);
  const [listH, setListH] = useState(0);
  // Säsongsdetaljer (snö i december, påsk, midsommar …) spelas när appen öppnas
  // och varje gång den kommer fram igen. Av med "Reducera rörelse"; hälsningen blir kvar.
  const reduceMotion = useReduceMotion();
  const [seasonRun, setSeasonRun] = useState(1);
  const season = useMemo(() => seasonFor(new Date()), [seasonRun]);
  const [rewardId, setRewardId] = useState(null);
  const [rewardAuto, setRewardAuto] = useState(false);
  const [celebrationId, setCelebrationId] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [toast, setToast] = useState(null);
  const [stampCard, setStampCard] = useState(null);  // "Ny stämpel"-arket
  const [celebrationCarry, setCelebrationCarry] = useState(0);  // överskott som följer med till nästa kort
  const [celebrationTier, setCelebrationTier] = useState(null);  // v10: en mindre belöning nåddes ({ at, text })
  const [rewardTier, setRewardTier] = useState(null);            // v10: belöning att föreslå i kodrutan
  const [wheel, setWheel] = useState(null);          // Dagens hjul: serverns läge (null = inte hämtat)
  const [wheelCity, setWheelCityState] = useState(null);   // vald stad (sparas bara på telefonen)
  const [rulesOpen, setRulesOpen] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [bottomH, setBottomH] = useState(96);
  // Konto (v14): frivilligt. authMethods = vilka inloggningssätt servern slagit på
  // (null = inte hämtat); account = { email } när telefonen är kopplad till ett konto.
  const [authMethods, setAuthMethods] = useState(null);
  const [account, setAccountState] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(true);
  const [accountEpoch, setAccountEpoch] = useState(0);   // ny telefonnyckel → sparat-räknaren börjar om
  // Födelsedagspresent (v15): birthday_status för kontot (null = inget konto / inte hämtat)
  const [birthday, setBirthdayState] = useState(null);
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  // Bjud in en vän (v16): invite_status (null = inte hämtat / server före v16)
  const [invite, setInviteState] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteHintOff, setInviteHintOff] = useState(true);
  const inviteRef = useRef(null);
  const loadInviteRef = useRef(null);
  const walletRef = useRef(wallet);
  useEffect(() => { walletRef.current = wallet; }, [wallet]);
  // Första stämpeln någonsin på telefonen (välkomstfirande). true tills flaggan lästs,
  // så att ett tidigt tapp aldrig ger ett felaktigt "första".
  const firstStampDoneRef = useRef(true);

  const nfc = useNfcStatus();

  // Dagens hjul: hämta läget. Varje hämtning numreras och ett svar används bara
  // om ingen senare hämtning redan gett ett giltigt läge — ett långsamt svar från
  // appstarten får aldrig skriva över läget efter ett snurr. Ett nätfel ersätter
  // inte ett känt läge.
  const wheelSeq = useRef(0);
  const wheelApplied = useRef(0);
  const loadWheel = useCallback(async () => {
    const seq = ++wheelSeq.current;
    const s = await wheelStatus();
    if (seq < wheelApplied.current) return s;
    if (s && s.ok) {
      wheelApplied.current = seq;
      setWheel(s);
    } else {
      setWheel((prev) => (prev && prev.ok ? prev : s));
    }
    return s;
  }, []);

  // Startup. The splash must only wait for LOCAL work (bundled fonts, NFC start,
  // cached wallet from AsyncStorage). Supabase is refreshed in the background —
  // before this, the splash stayed up through font downloads + two network calls.
  useEffect(() => {
    const applyCache = (c) => {
      if (!c || syncedRef.current) return;   // never overwrite fresher backend data
      setAllCafes(c.cafes);
      setWallet(c.wallet);
    };

    (async () => {
      const local = Promise.all([
        Font.loadAsync(FONT_FILES).catch(() => {}),
        initNfc(),
        readCache(),
      ]).then(([, , cache]) => cache);

      const first = await Promise.race([
        local,
        new Promise((resolve) => setTimeout(() => resolve("timeout"), LOCAL_BOOT_CAP_MS)),
      ]);
      if (first === "timeout") {
        local.then((c) => { applyCache(c); setFontEpoch((e) => e + 1); });   // late: re-render with fonts
      } else {
        applyCache(first);
      }
      setReady(true);

      // Show the intro only on the first launch, not on every start.
      // Independent of the network so a slow backend can't delay or swallow it.
      hasOnboarded().then((done) => { if (!done) setTimeout(() => setShowOnboarding(true), 1500); });
      hasFirstStamp().then((done) => { firstStampDoneRef.current = done; });
      getWheelCity().then((c) => { if (c) setWheelCityState(c); }).catch(() => {});

      // Background refresh. null = request failed -> keep cached state.
      // Hjulets läge sätter loadWheel själv (med ordningsskydd).
      const [cafes, rows] = await Promise.all([loadCafes(), loadWallet(), loadWheel()]);
      syncedRef.current = true;
      if (cafes) setAllCafes(cafes.map(normalizeCafe));
      if (rows) setWallet(walletFromRows(rows));
      setSynced(true);
    })();
  }, []);

  // Reglerna hör till hjulfliken — stäng dem när man byter flik.
  useEffect(() => { if (tab !== "wheel") setRulesOpen(false); }, [tab]);

  // Persist the latest known state for the next cold start.
  useEffect(() => {
    if (synced) writeCache(allCafes, wallet);
  }, [synced, allCafes, wallet]);

  const closeOnboarding = useCallback(() => { setShowOnboarding(false); markOnboarded(); }, []);

  const onLayoutReady = useCallback(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);

  // Refresh wallet from backend (after any action that may have changed state)
  const refreshWallet = useCallback(async () => {
    const rows = await loadWallet();
    if (!rows) return;   // request failed — keep current state
    setWallet(walletFromRows(rows));
  }, []);

  // Konto (v14): vilka inloggningssätt servern slagit på (hämtas igen om det misslyckades)
  const authMethodsRef = useRef(null);
  const loadAuthMethods = useCallback(async () => {
    const m = await getAuthMethods();
    if (m) { authMethodsRef.current = m; setAuthMethods(m); }
  }, []);
  // Kontot i en ref också, så att hämtningar som startar direkt efter ett byte ser det nya läget
  const accountRef = useRef(null);
  const applyAccount = useCallback((a) => { accountRef.current = a; setAccountState(a); }, []);
  // Födelsedagsveckan (v15) — bara för konton. Ett sent svar skriver aldrig över ett nyare.
  const birthdaySeq = useRef(0);
  const loadBirthday = useCallback(async () => {
    const seq = ++birthdaySeq.current;
    if (!accountRef.current) { setBirthdayState(null); return; }
    const s = await birthdayStatus();
    if (seq !== birthdaySeq.current || !s || !s.ok) return;
    setBirthdayState(s);
  }, []);

  // Tillbaka från bakgrunden: hämta kort och hjul igen. Annars kan appen visa en
  // utgången dubbelstämpel eller sakna pricken för dagens snurr tills något laddar om.
  useEffect(() => {
    let last = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      if (last === "background" && next === "active" && syncedRef.current) {
        refreshWallet();
        loadWheel();
        if (!authMethodsRef.current) loadAuthMethods();
        loadBirthday();
        if (loadInviteRef.current) loadInviteRef.current();
      }
      if (last === "background" && next === "active") setSeasonRun((n) => n + 1);
      last = next;
    });
    return () => sub.remove();
  }, [refreshWallet, loadWheel, loadAuthMethods, loadBirthday]);

  // Nytt snurr vid midnatt: hämta läget när serverns nästa snurrtid passerats,
  // så att pricken på Hjul-fliken dyker upp även om appen står öppen.
  // (Kontroll varje minut i stället för en lång timer — Android varnar för timers
  // på flera minuter, och en minuts fördröjning spelar ingen roll här.)
  useEffect(() => {
    if (!wheel || !wheel.ok || wheel.can_spin || !wheel.next_spin_at) return;
    const due = Date.parse(wheel.next_spin_at);
    if (!Number.isFinite(due)) return;
    const id = setInterval(() => { if (Date.now() >= due + 2000) loadWheel(); }, 60000);
    return () => clearInterval(id);
  }, [wheel, loadWheel]);

  // Lugna timmar: rita om när någon butiks lugna timme börjar eller slutar
  // (kontroll var 30:e sekund; nyckeln ändras bara när läget skiftar).
  const [quietKey, setQuietKey] = useState("");
  useEffect(() => {
    const check = () => {
      const key = [...Object.values(wallet), ...allCafes]
        .filter((c) => c && quietNow(c.quietHours)).map((c) => c.slug)
        .filter((s, i, a) => a.indexOf(s) === i).sort().join(",");
      setQuietKey((prev) => (prev === key ? prev : key));
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [wallet, allCafes]);

  // Ett meddelande i taget; ett nytt ersätter det gamla och får full visningstid.
  const toastTimer = useRef(null);
  const showToast = useCallback((t, ms) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => { toastTimer.current = null; setToast(null); }, ms);
  }, []);

  // Konto (v14): läget på telefonen, vilka inloggningssätt som är påslagna, och om
  // telefonen loggats ut från en annan telefon ("Logga ut andra telefoner").
  useEffect(() => {
    let alive = true;
    (async () => {
      const [a, dismissed] = await Promise.all([getAccount(), accountHintDismissed()]);
      if (!alive) return;
      applyAccount(a);
      setHintDismissed(dismissed);
      loadAuthMethods();
      if (!a) return;
      loadBirthday();
      const s = await accountStatus();
      if (!alive || !s.ok || s.linked) return;
      clearAccount();
      applyAccount(null);
      setBirthdayState(null);
      showToast({ type: "info", icon: "user", title: "Utloggad från kontot", subtitle: "Logga in igen för att se dina sparade stämplar." }, 5000);
    })();
    return () => { alive = false; };
  }, [loadAuthMethods, loadBirthday, applyAccount, showToast]);

  // Bjud in en vän (v16): läget, och meddelanden när en inbjuden vän stämplat (inbjudaren)
  // eller när den egna inbjudan gett stämplar (den nya kunden). Visas en gång.
  const applyInvite = useCallback((s) => { inviteRef.current = s; setInviteState(s); }, []);
  const loadInvite = useCallback(async () => {
    const before = inviteRef.current;
    const s = await inviteStatus();
    if (!s || !s.ok || s.unavailable) return s;
    applyInvite(s);
    const wasPending = !!(before && before.entered && before.entered.status === "pending");
    if (wasPending && s.entered && s.entered.status === "rewarded") {
      showToast({ type: "info", icon: "friends", title: "Välkomstbonus!", subtitle: "Du och din vän fick " + INVITE_STAMPS + " stämplar var" + (s.entered.cafe_name ? " hos " + s.entered.cafe_name : "") + "." }, 5500);
    } else if (Array.isArray(s.unseen) && s.unseen.length) {
      showToast({ type: "info", icon: "friends", ...unseenText(s.unseen) }, 5500);
      ackInvites();
      refreshWallet();
    }
    return s;
  }, [applyInvite, showToast, refreshWallet]);
  loadInviteRef.current = loadInvite;
  useEffect(() => { if (synced) loadInvite(); }, [synced, loadInvite]);
  const inviteCheckRef = useRef(false);   // en stämpling kan ha gett välkomstbonusen
  useEffect(() => { inviteHintDismissed().then(setInviteHintOff).catch(() => {}); }, []);

  const stampTimer = useRef(null);
  const closeStamp = useCallback(() => {
    if (stampTimer.current) clearTimeout(stampTimer.current);
    stampTimer.current = null;
    setStampCard(null);
  }, []);
  const showStamp = useCallback((card) => {
    if (stampTimer.current) clearTimeout(stampTimer.current);
    setStampCard(card);
    // Längre visning när mer händer: välkomstfirandet och dubbelstämpelns två nedslag.
    const ms = card.first ? 6500 : card.levelUp ? 6200 : card.added === 2 ? 5200 : 4500;
    stampTimer.current = setTimeout(() => { stampTimer.current = null; setStampCard(null); }, ms);
  }, []);

  const lastFailedTokenRef = useRef(null);

  // Send a tap to backend by token (e.g. "miyabi-01" or "bryggan-01"), with SUN from a
  // dynamic tag ({ token, sun }, v17)
  const sendTap = useCallback(async (input) => {
    const tag = asTag(input);
    if (!tag) return;
    const result = await tapToken(tag.token, tag.sun);
    if (!result.ok) {
      switch (result.error) {
        case "pending_reward": {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          showToast({ type: "pending-block", card: normalizeCafe(result.cafe) }, 5000);
          return;
        }
        case "cooldown": {
          // Backend v5: butikens väntetid (10 s–24 h) — visa läget, skäll inte.
          const cafe = normalizeCafe(result.cafe) || {};
          const secs = Number(result.retry_after_seconds) || 0;
          const mins = Number(result.retry_after_minutes) || Math.ceil(secs / 60);
          const when = secs > 0 && secs < 60 ? "om " + secs + " sek"
            : mins >= 60 ? "om " + Math.ceil(mins / 60) + " tim"
            : mins > 0 ? "om " + mins + " min" : "strax";
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          showToast({
            type: "info",
            title: "Redan stämplad hos " + cafe.name,
            subtitle: "Nästa stämpel " + when + " · " + (result.stamps ?? 0) + " av " + cafe.needed,
          }, 3500);
          return;
        }
        case "unknown_tag":
        case "inactive_cafe": {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({ type: "unknown" }, 3500);
          return;
        }
        // Dynamisk tagg (v17): läsningen har redan räknats — "Försök igen" efter ett svar som
        // aldrig kom fram, eller en gammal länk som öppnats igen. Inget att visa; korten
        // hämtas på nytt så att en stämpel som faktiskt gavs syns.
        case "replay": {
          lastFailedTokenRef.current = null;
          refreshWallet();
          return;
        }
        // Taggen godtar bara dynamiska läsningar men fick en länk utan e/c
        // (t.ex. "Jag har redan appen" på tappass.se/t/…).
        case "sdm_required": {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          showToast({
            type: "info", icon: "nfc", title: "Läs av stämpeln i kassan",
            subtitle: Platform.OS === "ios" ? "Tryck på Skanna och håll iPhonen mot stämpeln – en länk räcker inte." : "Stämpeln räknas bara när telefonen hålls mot den – en länk räcker inte.",
          }, 4500);
          return;
        }
        case "sdm_invalid": {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({ type: "unknown", title: "Stämpeln kunde inte kontrolleras", subtitle: "Försök igen. Fungerar det inte – säg till personalen." }, 4500);
          return;
        }
        default: {
          // "network", "bad_device" or anything unexpected: never blame the tag.
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          lastFailedTokenRef.current = tag;
          showToast({ type: "network", canRetry: true }, 5000);
          return;
        }
      }
    }

    lastFailedTokenRef.current = null;
    // Första stämpeln någonsin: inga kort på telefonen och flaggan inte satt.
    const first = !firstStampDoneRef.current && Object.keys(walletRef.current).length === 0;
    if (!firstStampDoneRef.current) { firstStampDoneRef.current = true; markFirstStamp(); }
    // En lyckad stämpel förbrukar alltid en aktiv dubbelstämpel hos butiken.
    const card = normalizeCard({ cafe: result.cafe, stamps: result.stamps, pending: false });
    // Sparat-räknaren följer med; första stämpeln i dag hos stället är ett nytt besök (v11).
    const before = walletRef.current[card.slug];
    const levelUp = before && before.hasLevels ? crossedLevel(before.visits, afterTap(card, before).visits) : null;
    setWallet((prev) => ({ ...prev, [card.slug]: afterTap(keepSavings(card, prev[card.slug]), prev[card.slug]) }));
    if (result.bonus_applied) loadWheel();
    // v16: väntar den egna inbjudan på första stämpeln? Då gav den här stämplingen bonusen —
    // läget hämtas när stämpelarket stängts, så att meddelandet inte hamnar bakom det.
    const inv = inviteRef.current;
    if (inv && inv.entered && inv.entered.status === "pending") inviteCheckRef.current = true;

    const added = result.stamps_added === 2 ? 2 : 1;
    const tier = result.complete ? null : crossedTier(card, added);
    if (result.complete || tier) {
      // Fullt kort, eller en mindre belöning nåddes (v10): firandet med valet
      // "Lös in nu" eller (mindre belöning) "Samla vidare".
      setCelebrationCarry(result.complete ? Number(result.carry_over) || 0 : 0);
      setCelebrationTier(tier);
      setTimeout(() => setCelebrationId(card.slug), 700);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      // Vibrationen kommer från arket, i takt med att stämpeln slår ner.
      showStamp({ ...card, added, first, quiet: !!result.quiet_applied, levelUp });
    }
  }, [showToast, showStamp, loadWheel, refreshWallet]);

  // Välkomstbonusen (v16) visas när stämpelarket och firandet är stängda
  useEffect(() => {
    if (!inviteCheckRef.current || stampCard || celebrationId) return undefined;
    inviteCheckRef.current = false;
    const t = setTimeout(() => loadInvite(), 300);
    return () => clearTimeout(t);
  }, [stampCard, celebrationId, loadInvite]);

  // Ett fysiskt tryck kan nå appen två gånger (NFC-loopen + App Link-intentet,
  // eller en tagg som ligger kvar mot telefonen). Samma token inom 5 s ignoreras —
  // jämfört utan e/c, eftersom en dynamisk tagg (v17) ger ny adress vid varje läsning;
  // servern spärrar dessutom med butikens väntetid. Gäller inte dev-simulering.
  // Inlösen med tapp (v9): medan kodrutan väntar på butikens stämpel ska nästa lästa
  // stämpel lösa in i stället för att stämpla. RewardSheet registrerar sig här och får
  // bara token (inlösen kontrollerar inte SUN).
  const redeemRef = useRef(null);
  const registerRedeem = useCallback((handler) => { redeemRef.current = handler; }, []);
  // "Lös in" på ett kort i kortbunten (stabil, så att kortraderna inte ritas om i onödan).
  const openRewardFromCard = useCallback((slug) => { setTab("home"); setRewardAuto(false); setRewardTier(null); setRewardId(slug); }, []);

  const lastTagRef = useRef({ token: null, at: 0 });
  const sendTagTap = useCallback((input) => {
    const tag = asTag(input);
    if (!tag) return;
    const redeem = redeemRef.current;
    const key = (redeem ? "r:" : "t:") + tag.token;
    const now = Date.now();
    if (lastTagRef.current.token === key && now - lastTagRef.current.at < (redeem ? 2000 : 5000)) return;
    lastTagRef.current = { token: key, at: now };
    if (redeem) return redeem(tag.token);
    return sendTap(tag);
  }, [sendTap]);

  // Tag is tapped via NFC deep-link (https://tappass.se/t/<token>[?e=…&c=…]) or local simulate
  const handleUrl = useCallback((url) => {
    const tag = tagFromUrl(url);
    if (!tag) return;
    sendTagTap(tag);
    setTab("home");
  }, [sendTagTap]);

  useEffect(() => {
    Linking.getInitialURL().then((url) => { if (url) handleUrl(url); });
    const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));
    return () => sub.remove();
  }, [handleUrl]);

  if (!ready) return null;

  const cards = Object.values(wallet);
  const savings = walletSavings(cards);   // v10: sparat-räknaren
  const pendingCards = cards.filter((c) => c.pendingReward);
  // Fullt kort som inte sparats (rutan stängd före "Lös in", misslyckat sparande,
  // appen stängd under firandet). Måste synas — annars
  // finns belöningen bara i databasen och kunden hittar den aldrig.
  const readyCards = cards.filter((c) => !c.pendingReward && c.stamps >= c.needed);
  const progressCards = cards.filter((c) => !c.pendingReward && c.stamps < c.needed);

  const onSaveReward = async () => {
    setLoadingAction(true);
    await saveReward(celebrationId);
    await refreshWallet();
    setLoadingAction(false);
    setCelebrationId(null);
  };
  // Kodrutan öppnas alltid över fliken Kort: där körs Androids NFC-loop som läser
  // butikens stämpel vid inlösen med tapp.
  // auto: kunden tryckte "Lös in nu" i firandet — rutan sparar direkt och väntar på stämpeln.
  // tierAt (v10): belöningen kunden valde i firandet (mindre belöning) — annars föreslår rutan den största.
  const openReward = (slug, auto = false, tierAt = null) => { setTab("home"); setRewardAuto(auto); setRewardTier(tierAt); setRewardId(slug); };
  const onRedeemNow = () => {
    openReward(celebrationId, true, celebrationTier ? celebrationTier.at : null);
    setCelebrationId(null);
    setCelebrationTier(null);
  };
  // Inlöst (med butikens stämpel, eller personalen skrev in koden) → hämta nytt kortläge.
  // Kodrutan visar "Inlöst!" och stängs av kunden.
  const onRedeemed = async () => {
    setLoadingAction(true);
    await refreshWallet();
    setLoadingAction(false);
  };

  const onSnackAction = (a) => {
    setToast(null);
    if (a.type === "open-reward" && a.slug) openReward(a.slug);
    if (a.type === "retry" && lastFailedTokenRef.current) sendTap(lastFailedTokenRef.current);
  };

  // Dagens hjul: vinsten är hämtad → kortet med bonusen syns under Kort.
  // cafe = null: servern hade redan sparat valet (ett tidigare svar tappades).
  const onWheelClaimed = async (cafe, expiresAt) => {
    await refreshWallet();
    setTab("home");
    if (cafe) {
      showToast({
        type: "info",
        icon: "gift",
        title: "Dubbelstämpel hos " + cafe.name,
        subtitle: "Nästa stämpel där ger 2 · " + expiryText(expiresAt),
      }, 4500);
    } else {
      showToast({ type: "info", icon: "gift", title: "Vinsten är redan hämtad", subtitle: "Dubbelstämpeln syns på kortet." }, 4000);
    }
  };

  // Konto (v14): telefonen kopplades, loggades ut (här eller från en annan telefon), fick
  // ny nyckel eller kontot raderades. Telefonens id kan ha bytts — hämta kort och hjul igen.
  const onAccountChanged = async (ev) => {
    if (ev.type === "birthday") { loadBirthday(); return; }   // v15: födelsedagen sparad eller borttagen
    if (ev.type === "linked") {
      const a = { email: ev.email, since: new Date().toISOString() };
      applyAccount(a);
      setAccount(a);
    } else if (ev.type !== "rotated") {
      // logout: nytt slumpat id (deleteAccount har redan bytt id; "gone" behåller sitt)
      if (ev.type === "logout") await newDeviceId().catch(() => {});
      applyAccount(null);
      clearAccount();
      if (ev.type !== "gone") setWallet({});
    }
    loadBirthday();
    loadInvite();
    const [rows] = await Promise.all([loadWallet(), loadWheel()]);
    if (rows) setWallet(walletFromRows(rows));
    setAccountEpoch((n) => n + 1);   // sparat-räknaren utgår från de nya korten (räknar inte upp)
    if (ev.type === "logout") showToast({ type: "info", icon: "logout", title: "Utloggad från den här telefonen", subtitle: "Dina stämplar finns kvar på kontot." }, 4500);
    if (ev.type === "rotated") showToast({ type: "info", icon: "shield", title: "Andra telefoner är utloggade", subtitle: "Den här telefonen fortsätter som vanligt." }, 4500);
    if (ev.type === "deleted") showToast({ type: "info", icon: "trash", title: "Kontot är raderat", subtitle: "Du kan fortsätta samla stämplar utan konto." }, 4500);
  };
  // Kontoknappen syns när inloggningen är påslagen (eller telefonen redan är kopplad).
  const accountOn = !!account || !!(authMethods && authMethods.email);
  const showAccountHint = !account && !!(authMethods && authMethods.email) && !hintDismissed;
  const onDismissHint = () => { setHintDismissed(true); dismissAccountHint(); };
  // v15: födelsedagsrutan medan veckan pågår och någon present finns kvar
  const birthdayBanner = account ? bannerText(birthday) : null;
  const birthdayOn = !!(account && birthday && birthday.ok && !birthday.unavailable);
  const birthdayOffered = allCafes.some((c) => c.birthdayText);
  // v16: rutan "Bjud in en vän" under korten (aldrig samtidigt som kontorutan)
  const showInviteHint = !!invite && !showAccountHint && !inviteHintOff;
  const onDismissInvite = () => { setInviteHintOff(true); dismissInviteHint(); };
  const onInviteChanged = (ev) => {
    if (ev.status) applyInvite(ev.status);
    if (ev.redeemed) { loadInvite(); if (ev.redeemed.status === "rewarded") refreshWallet(); }
  };

  const titles = { home: "Dina kort", wheel: "Dagens hjul", discover: "Ställen" };
  // Pricken på Hjul: oupphämtad vinst, eller ett snurr som faktiskt kan ge något i
  // kundens stad (inte när kunden redan har dubbelstämpel hos alla ställen där).
  const cityAvail = wheelCity && wheel && wheel.ok ? availableIn(wheelCity, wheel.cities) : null;
  const wheelReady = !!(wheel && wheel.ok && (wheel.cities || []).length > 0 &&
    (wheel.prize || (wheel.can_spin && cityAvail !== 0)));

  // Dev-only: the simulate row sends the same tap_token call as a physical tag.
  // Never shipped to production (__DEV__ is false in EAS production/preview builds).
  const simulateStamp = __DEV__ ? (cafe) => sendTap(cafe.slug + "-01") : null;

  const rewardCard = rewardId ? wallet[rewardId] : null;
  const celebrationCard = celebrationId ? wallet[celebrationId] : null;

  return (
    <SafeAreaProvider key={fontEpoch}>
      <StatusBar barStyle="dark-content" backgroundColor={T.bg} />
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: T.bg }} onLayout={onLayoutReady}>
        <Header
          title={titles[tab]}
          onHelp={() => (tab === "wheel" ? setRulesOpen(true) : setShowOnboarding(true))}
          helpLabel={tab === "wheel" ? "Regler för Dagens hjul" : "Hjälp och introduktion"}
          loading={loadingAction}
          account={accountOn ? account || false : null}
          onAccount={() => setAccountOpen(true)}
        />

        <Animated.ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onLayout={(e) => setListH(e.nativeEvent.layout.height)}
          refreshControl={<RefreshControl refreshing={false} onRefresh={tab === "wheel" ? loadWheel : refreshWallet} tintColor={T.inkMute} colors={[T.primary]} />}
        >
          {tab === "home" ? (
            <HomeTab
              readyCards={readyCards}
              pendingCards={pendingCards}
              progressCards={progressCards}
              filter={filter}
              setFilter={setFilter}
              onOpenReward={openRewardFromCard}
              onFindPlaces={() => setTab("discover")}
              onSimulate={simulateStamp}
              cafes={allCafes}
              scrollY={scrollY}
              listH={listH}
              season={season}
              quietKey={quietKey}
              savings={savings}
              savingsHold={!!(rewardId || celebrationId)}
              savingsKey={accountEpoch}
              synced={synced}
              accountHint={showAccountHint}
              onAccountHint={() => setAccountOpen(true)}
              onDismissHint={onDismissHint}
              birthdayBanner={birthdayBanner}
              onOpenBirthday={() => setBirthdayOpen(true)}
              inviteHint={showInviteHint}
              onInvite={invite ? () => setInviteOpen(true) : null}
              onDismissInvite={onDismissInvite}
            />
          ) : tab === "wheel" ? (
            <DailyWheel
              status={wheel}
              onReload={loadWheel}
              onToast={showToast}
              onClaimed={onWheelClaimed}
              onCityChange={setWheelCityState}
              rulesVisible={rulesOpen}
              onOpenRules={() => setRulesOpen(true)}
              onCloseRules={() => setRulesOpen(false)}
            />
          ) : (
            <PlacesTab cafes={allCafes} wallet={wallet} quietKey={quietKey} onInvite={invite ? () => setInviteOpen(true) : null} />
          )}
        </Animated.ScrollView>

        {!reduceMotion && season && season.fall && <SeasonFall key={"season" + seasonRun} {...season.fall} />}
        {!reduceMotion && season && season.burst && (
          <Confetti key={"nyar" + seasonRun} colors={["#E3B53B", T.lime, T.primary, "#F2AFC4", "#FFFFFF"]} from={[
            { x: Dimensions.get("window").width * 0.28, y: 170, count: 22, spread: 180, speed: [380, 720], delay: 300 },
            { x: Dimensions.get("window").width * 0.74, y: 120, count: 22, spread: 180, speed: [380, 720], delay: 900 },
          ]} />
        )}

        <View onLayout={(e) => setBottomH(e.nativeEvent.layout.height)}>
          {tab === "home" && <LiveScanner nfc={nfc} onSendTap={sendTagTap} />}
          <BottomNav tab={tab} setTab={setTab} wheelReady={wheelReady} />
        </View>

        <Snackbar toast={toast} bottom={bottomH + 12} onAction={onSnackAction} />

        <StampSheet card={stampCard} onClose={closeStamp} />
        <RewardSheet visible={!!rewardId} card={rewardCard} onClose={() => { setRewardId(null); setRewardAuto(false); setRewardTier(null); }} onRedeemed={onRedeemed} onCancelled={refreshWallet} registerRedeem={registerRedeem} autoRedeem={rewardAuto} preferTier={rewardTier} />
        <CelebrationScreen visible={!!celebrationCard} card={celebrationCard} carry={celebrationCarry} tier={celebrationTier} busy={loadingAction} onSave={onSaveReward} onRedeemNow={onRedeemNow} onClose={() => { setCelebrationId(null); setCelebrationTier(null); }} />
        <AppLinkOnboarding visible={showOnboarding} onClose={closeOnboarding} />
        <AccountSheet visible={accountOpen} account={account} onChanged={onAccountChanged} onClose={() => setAccountOpen(false)}
          birthday={birthday} birthdayOn={birthdayOn} birthdayOffered={birthdayOffered} />
        <BirthdaySheet visible={birthdayOpen} status={birthday} cafes={allCafes} registerRedeem={registerRedeem} onChanged={loadBirthday} onClose={() => setBirthdayOpen(false)} />
        <InviteSheet visible={inviteOpen} status={invite} onChanged={onInviteChanged} onClose={() => setInviteOpen(false)} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// account: null = ingen kontoknapp (inloggningen avstängd), false = inte inloggad, { email } = inloggad
function Header({ title, onHelp, helpLabel, loading, account, onAccount }) {
  const round = (pressed, bg) => ({ width: 48, height: 48, borderRadius: 24, backgroundColor: bg, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.8 : 1 });
  return (
    <View style={{ paddingLeft: 20, paddingRight: 16, paddingTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1, fontFamily: FONT.title, fontSize: 34, lineHeight: 40, color: T.ink }}>{title}</Text>
        {loading && <ActivityIndicator size="small" color={T.inkMute} />}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {account !== null && (
          <Pressable accessibilityLabel={account ? "Konto, inloggad" : "Konto: spara dina stämplar"} onPress={onAccount} style={({ pressed }) => round(pressed, account ? T.primaryContainer : T.container)}>
            <Icon name="user" size={22} color={account ? T.onPrimaryContainer : T.ink} />
            {!!account && <View style={{ position: "absolute", right: 7, bottom: 7, width: 14, height: 14, borderRadius: 7, backgroundColor: T.primary, borderWidth: 2, borderColor: T.primaryContainer, alignItems: "center", justifyContent: "center" }}><Icon name="check" size={8} color="#FFFFFF" strokeWidth={4} /></View>}
          </Pressable>
        )}
        <Pressable accessibilityLabel={helpLabel || "Hjälp och introduktion"} onPress={onHelp} style={({ pressed }) => round(pressed, T.container)}>
          <Icon name="help" size={22} color={T.ink} />
        </Pressable>
      </View>
    </View>
  );
}

function Chip({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={{ height: 32, paddingLeft: selected ? 8 : 12, paddingRight: 12, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: selected ? T.secondaryContainer : "transparent", borderWidth: selected ? 0 : 1, borderColor: T.outline }}
    >
      {selected && <Icon name="check" size={18} color={T.onSecondaryContainer} strokeWidth={2.4} />}
      <Text style={{ fontFamily: selected ? FONT.semibold : FONT.medium, fontSize: 14, color: selected ? T.onSecondaryContainer : T.inkSoft }}>{label}</Text>
    </Pressable>
  );
}

// Dagens hälsning (Lucia, jul, nyår, fettisdagen, påsk, midsommar, kanelbullens dag).
function SeasonChip({ season }) {
  const chip = season.chip || { kind: "sunny8", color: T.lime };
  return (
    <View style={{ marginLeft: "auto", height: 32, paddingLeft: 6, paddingRight: 12, borderRadius: 16, backgroundColor: T.surface, borderWidth: 1, borderColor: T.hairline, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Shape kind={chip.kind} size={20} color={chip.color} />
      <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: T.ink }}>{season.greeting}</Text>
    </View>
  );
}

function HomeTab({ readyCards, pendingCards, progressCards, filter, setFilter, onOpenReward, onFindPlaces, onSimulate, cafes, scrollY, listH, season, quietKey, savings, savingsHold, savingsKey, synced, accountHint, onAccountHint, onDismissHint, birthdayBanner, onOpenBirthday, inviteHint, onInvite, onDismissInvite }) {
  const all = [...readyCards, ...pendingCards, ...progressCards];
  const rewardCount = readyCards.length + pendingCards.length;
  const f = rewardCount > 0 ? filter : "all";
  const shown = f === "ready" ? [...readyCards, ...pendingCards] : all;

  if (all.length === 0) {
    return <EmptyHome onFindPlaces={onFindPlaces} onSimulate={onSimulate} cafes={cafes} onInviteCode={onInvite} />;
  }

  return (
    <View>
      {/* Födelsedagsveckan (v15) och sparat-räknaren (v10). Ligger i hemflikens topp: kortbunten mäter sitt läge själv. */}
      {!!birthdayBanner && <BirthdayBanner banner={birthdayBanner} onOpen={onOpenBirthday} />}
      {savings && <SavingsBanner key={"sparat" + (savingsKey || 0)} savings={savings} hold={savingsHold} synced={synced} />}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
        <Chip label={"Alla · " + all.length} selected={f === "all"} onPress={() => setFilter("all")} />
        {rewardCount > 0 && <Chip label={"Klar att hämta · " + rewardCount} selected={f === "ready"} onPress={() => setFilter("ready")} />}
        {!!(season && season.greeting) && <SeasonChip season={season} />}
      </View>
      <CardStack cards={shown} onOpenReward={onOpenReward} scrollY={scrollY} viewH={listH} quietKey={quietKey} />
      {accountHint && <AccountHint onOpen={onAccountHint} onDismiss={onDismissHint} />}
      {inviteHint && <InviteHint onOpen={onInvite} onDismiss={onDismissInvite} />}
      {__DEV__ && onSimulate && <DevSimulate cafes={cafes} onSimulate={onSimulate} />}
    </View>
  );
}

// Födelsedagsveckan (v15): "Grattis på födelsedagen! En present hos Café Linnea · t.o.m. 20 november"
function BirthdayBanner({ banner, onOpen }) {
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityHint="Visa dina födelsedagspresenter"
      style={({ pressed }) => ({ marginTop: 14, paddingVertical: 14, paddingLeft: 14, paddingRight: 12, borderRadius: 24, backgroundColor: T.tertiaryContainer, flexDirection: "row", alignItems: "center", gap: 14, opacity: pressed ? 0.9 : 1 })}>
      <Shape kind="flower8" size={52} color={PINK} rotate={8}>
        <Icon name="cake" size={24} color={T.onTertiaryContainer} />
      </Shape>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.title, fontSize: 17, lineHeight: 22, color: T.onTertiaryContainer }}>{banner.title}</Text>
        <Text style={{ marginTop: 2, fontFamily: FONT.regular, fontSize: 14, lineHeight: 19, color: T.onTertiaryContainer }}>{banner.text}</Text>
      </View>
      <Icon name="chev" size={20} color={T.onTertiaryContainer} />
    </Pressable>
  );
}

// Bjud in en vän (v16): under korten när kontorutan inte visas, tills kunden stänger den.
function InviteHint({ onOpen, onDismiss }) {
  return (
    <View style={{ marginTop: 16, padding: 16, paddingRight: 8, borderRadius: 24, borderWidth: 1.5, borderStyle: "dashed", borderColor: T.outline, flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
      <Shape kind="clover4" size={48} color={T.secondaryContainer}>
        <Icon name="friends" size={22} color={T.onSecondaryContainer} />
      </Shape>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.title, fontSize: 16, lineHeight: 22, color: T.ink }}>Bjud in en vän</Text>
        <Text style={{ marginTop: 2, fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: T.inkSoft }}>Ni får {INVITE_STAMPS} stämplar var när din vän stämplar första gången.</Text>
        <Pressable onPress={onOpen} accessibilityRole="button" style={{ marginTop: 6, alignSelf: "flex-start", minHeight: 40, justifyContent: "center" }}>
          <Text style={{ fontFamily: FONT.bold, fontSize: 14, color: T.primary }}>Dela din kod</Text>
        </Pressable>
      </View>
      <Pressable accessibilityLabel="Stäng tipset om att bjuda in" onPress={onDismiss} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }}>
        <Icon name="close" size={20} color={T.inkSoft} />
      </Pressable>
    </View>
  );
}

// Konto (v14): under korten, tills kunden skapat konto eller stängt rutan.
function AccountHint({ onOpen, onDismiss }) {
  return (
    <View style={{ marginTop: 16, padding: 16, paddingRight: 8, borderRadius: 24, borderWidth: 1.5, borderStyle: "dashed", borderColor: T.outline, flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
      <Shape kind="cookie9" size={48} color={T.primaryContainer}>
        <Icon name="cloudCheck" size={22} color={T.onPrimaryContainer} />
      </Shape>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.title, fontSize: 16, lineHeight: 22, color: T.ink }}>Spara dina stämplar</Text>
        <Text style={{ marginTop: 2, fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: T.inkSoft }}>Utan konto finns de bara i den här telefonen.</Text>
        <Pressable onPress={onOpen} accessibilityRole="button" style={{ marginTop: 6, alignSelf: "flex-start", minHeight: 40, justifyContent: "center" }}>
          <Text style={{ fontFamily: FONT.bold, fontSize: 14, color: T.primary }}>Skapa konto</Text>
        </Pressable>
      </View>
      <Pressable accessibilityLabel="Stäng tipset om konto" onPress={onDismiss} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }}>
        <Icon name="close" size={20} color={T.inkSoft} />
      </Pressable>
    </View>
  );
}

function EmptyHome({ onFindPlaces, onSimulate, cafes, onInviteCode }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 32 }}>
      <View style={{ width: 240, height: 210 }}>
        <Shape kind="cookie12" size={190} color={T.container} style={{ position: "absolute", left: 25, top: 10 }}>
          <Icon name="nfc" size={56} color={T.inkSoft} strokeWidth={1.8} />
        </Shape>
        <Shape kind="sunny8" size={72} color={T.primaryContainer} style={{ position: "absolute", right: 0, top: 0 }} />
        <Shape kind="clover4" size={60} color="#D3E8EC" style={{ position: "absolute", left: 0, bottom: 6 }} />
      </View>
      <Text style={{ marginTop: 20, fontFamily: FONT.title, fontSize: 28, lineHeight: 36, color: T.ink, textAlign: "center" }}>Inga kort än</Text>
      <Text style={{ marginTop: 8, maxWidth: 300, fontFamily: FONT.regular, fontSize: 16, lineHeight: 24, color: T.inkSoft, textAlign: "center" }}>
        {Platform.OS === "ios"
          ? "Tryck på Skanna stämpel och håll telefonen mot en TapPass-stämpel i kassan, så dyker ditt första kort upp här."
          : "Tappa telefonen mot en TapPass-stämpel i kassan, så dyker ditt första kort upp här."}
      </Text>
      <Pressable onPress={onFindPlaces} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 20, height: 48, paddingLeft: 18, paddingRight: 24, borderRadius: 24, backgroundColor: T.secondaryContainer, flexDirection: "row", alignItems: "center", gap: 8, opacity: pressed ? 0.85 : 1 })}>
        <Icon name="pin" size={20} color={T.onSecondaryContainer} />
        <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: T.onSecondaryContainer }}>Se ställen med TapPass</Text>
      </Pressable>
      {/* v16: ny kund med en väns kod */}
      {!!onInviteCode && (
        <Pressable onPress={onInviteCode} accessibilityRole="button" style={{ marginTop: 10, minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }}>
          <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: T.primary }}>Har du en kod från en vän?</Text>
        </Pressable>
      )}
      {__DEV__ && onSimulate && <DevSimulate cafes={cafes} onSimulate={onSimulate} />}
    </View>
  );
}

function DevSimulate({ cafes, onSimulate }) {
  if (!cafes || cafes.length === 0) return null;
  return (
    <View style={{ marginTop: 28, alignSelf: "stretch" }}>
      <Text style={{ fontFamily: FONT.bold, fontSize: 11, letterSpacing: 0.88, color: T.inkMute, textAlign: "center", marginBottom: 10 }}>DEV · SIMULERA EN DISK</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        {cafes.map((b) => (
          <Pressable key={b.slug} onPress={() => onSimulate(b)} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: T.outline, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: T.inkSoft }}>+1 {b.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function PlacesTab({ cafes, wallet, quietKey, onInvite }) {
  const [q, setQ] = useState("");
  const [place, setPlace] = useState(null);   // v13: ställets sida (slug)
  const [type, setType] = useState(null);
  const types = useMemo(
    () => [...new Set(cafes.map((c) => c.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, "sv")),
    [cafes]
  );
  const query = q.trim().toLowerCase();
  const list = cafes.filter((c) =>
    (!type || c.type === type) &&
    (!query || [c.name, c.area, c.type].some((v) => String(v || "").toLowerCase().includes(query)))
  );

  const tip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Share.share({ message: "Har ni koll på TapPass? Digitala stämpelkort som kunderna samlar med mobilen i kassan – inget papperskort att tappa bort. https://tappass.se" }).catch(() => {});
  };

  return (
    <View style={{ paddingBottom: 8 }}>
      <View style={{ marginTop: 14, height: 56, borderRadius: 28, backgroundColor: T.container, paddingLeft: 16, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Icon name="search" size={22} color={T.inkSoft} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Sök ställe eller område"
          placeholderTextColor={T.inkSoft}
          returnKeyType="search"
          autoCorrect={false}
          style={{ flex: 1, height: 56, fontFamily: FONT.regular, fontSize: 16, color: T.ink, paddingVertical: 0 }}
        />
        {!!q && (
          <Pressable accessibilityLabel="Rensa sökning" onPress={() => setQ("")} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }}>
            <Icon name="close" size={20} color={T.inkSoft} />
          </Pressable>
        )}
      </View>

      {types.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14, marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          <Chip label="Alla" selected={!type} onPress={() => setType(null)} />
          {types.map((t) => <Chip key={t} label={t} selected={type === t} onPress={() => setType(type === t ? null : t)} />)}
        </ScrollView>
      )}

      <Text style={{ marginTop: 20, marginBottom: 8, marginLeft: 4, fontFamily: FONT.semibold, fontSize: 14, color: T.inkSoft }}>
        {list.length} {list.length === 1 ? "ställe" : "ställen"}
      </Text>

      <View style={{ gap: 10 }}>
        {list.map((c) => <PlaceCard key={c.slug} cafe={c} card={wallet[c.slug]} quiet={quietKey ? quietNow(c.quietHours) : null} onPress={() => setPlace(c.slug)} />)}
      </View>

      {list.length === 0 && cafes.length > 0 && (
        <Text style={{ marginTop: 4, marginLeft: 4, fontFamily: FONT.regular, fontSize: 15, color: T.inkSoft }}>
          Inga ställen matchar {query ? "”" + q.trim() + "”" : "filtret"}.
        </Text>
      )}

      {/* v16: Bjud in en vän */}
      {!!onInvite && (
        <Pressable onPress={onInvite} accessibilityRole="button" accessibilityHint="Dela din kod med en vän"
          style={({ pressed }) => ({ marginTop: 10, padding: 16, borderRadius: 24, backgroundColor: T.secondaryContainer, flexDirection: "row", alignItems: "center", gap: 14, opacity: pressed ? 0.9 : 1 })}>
          <Shape kind="clover4" size={48} color={T.surface}>
            <Icon name="friends" size={22} color={T.onSecondaryContainer} />
          </Shape>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONT.title, fontSize: 16, lineHeight: 22, color: T.onSecondaryContainer }}>Bjud in en vän</Text>
            <Text style={{ marginTop: 2, fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: T.onSecondaryContainer }}>Ni får {INVITE_STAMPS} stämplar var när din vän stämplar första gången.</Text>
          </View>
          <Icon name="chev" size={20} color={T.onSecondaryContainer} />
        </Pressable>
      )}

      <View style={{ marginTop: 10, padding: 16, borderRadius: 24, borderWidth: 1.5, borderStyle: "dashed", borderColor: T.outline, flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
        <Shape kind="sunny8" size={48} color={T.tertiaryContainer}>
          <Icon name="megaphone" size={22} color={T.onTertiaryContainer} />
        </Shape>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONT.title, fontSize: 16, lineHeight: 22, color: T.ink }}>Saknar du ditt favoritställe?</Text>
          <Text style={{ marginTop: 2, fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: T.inkSoft }}>Skicka ett tips om TapPass till dem.</Text>
          <Pressable onPress={tip} accessibilityRole="button" style={{ marginTop: 6, alignSelf: "flex-start", minHeight: 40, justifyContent: "center" }}>
            <Text style={{ fontFamily: FONT.bold, fontSize: 14, color: T.primary }}>Tipsa ett ställe</Text>
          </Pressable>
        </View>
      </View>

      <PlaceSheet cafe={place ? cafes.find((c) => c.slug === place) : null} card={place ? wallet[place] : null} onClose={() => setPlace(null)} />
    </View>
  );
}

function PlaceCard({ cafe, card, quiet, onPress }) {
  const t = toneFor(cafe.ink);
  const meta = [cafe.type, cafe.area].filter(Boolean).join(" · ");
  const needed = cafe.needed || card?.needed || 0;
  const progress = card
    ? (card.pendingReward || card.stamps >= card.needed ? "Klar" : card.stamps + "/" + card.needed)
    : null;
  const bonusOn = !!card && isActiveUntil(card.bonusExpiresAt);
  const visits = card && card.hasLevels ? card.visits : 0;   // v11: stamgästnivå
  const schedule = quietSummary(cafe.quietHours);
  const periods = quietParts(cafe.quietHours);
  const open = openState(cafe.openingHours);   // v13: öppettider
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={"Visa mer om " + cafe.name}
      style={({ pressed }) => ({ padding: 16, borderRadius: 24, backgroundColor: t.container, flexDirection: "row", alignItems: "center", gap: 14, opacity: pressed ? 0.9 : 1 })}
    >
      <CafeAvatar cafe={cafe} size={52} color={t.primary} fontSize={20} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: FONT.title, fontSize: 18, lineHeight: 24, color: t.onContainer }}>{cafe.name}</Text>
        {!!meta && <Text numberOfLines={1} style={{ fontFamily: FONT.regular, fontSize: 14, lineHeight: 19, color: t.muted }}>{meta}</Text>}
        <View style={{ marginTop: 4, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="gift" size={16} color={t.onContainer} />
          <Text style={{ flex: 1, fontFamily: FONT.medium, fontSize: 14, lineHeight: 19, color: t.onContainer }}>
            {cafe.rewardShort || cafe.reward}{needed ? " efter " + needed + " stämplar" : ""}
          </Text>
        </View>
        {!!open && (
          <View style={{ marginTop: 4, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 8, height: 8, marginHorizontal: 4, borderRadius: 4, backgroundColor: open.open ? "#2E7D32" : t.muted }} />
            <Text style={{ flex: 1, fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: t.muted }}>{openText(open)}</Text>
          </View>
        )}
        {visits > 0 && (
          <View accessible accessibilityLabel={progressText(visits) + " (besök senaste 12 månaderna)"} style={{ marginTop: 4, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="award" size={16} color={levelFor(visits) ? levelFor(visits).accent : t.onContainer} />
            <Text style={{ flex: 1, fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: t.muted }}>{progressText(visits)}</Text>
          </View>
        )}
        {!!schedule && (
          <View accessible accessibilityLabel={"Lugna timmar " + schedule + ": varje stämpel ger 2"} style={{ marginTop: 4, flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
            <Icon name="timer" size={16} color={t.onContainer} />
            {/* Varje del bryts hel, så att "14–16" aldrig delas mellan raderna */}
            <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", columnGap: 4 }}>
              {["Dubbla stämplar", ...periods].map((p, i) => (
                <Text key={i} style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: t.muted }}>{p + (i > 0 && i < periods.length ? " ·" : "")}</Text>
              ))}
            </View>
          </View>
        )}
      </View>
      {(!!progress || bonusOn || !!quiet) && (
        <View style={{ alignSelf: "flex-start", alignItems: "flex-end", gap: 6 }}>
          {!!progress && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: t.primary }}>
              <Text style={{ fontFamily: FONT.bold, fontSize: 13, color: "#FFFFFF" }}>{progress}</Text>
            </View>
          )}
          {bonusOn && (
            <View accessibilityLabel="Dubbelstämpel aktiv" style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: T.lime }}>
              <Text style={{ fontFamily: FONT.bold, fontSize: 13, color: T.onPrimaryContainer }}>×2</Text>
            </View>
          )}
          {!!quiet && (
            <View accessibilityLabel="Lugn timme just nu: varje stämpel ger 2" style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: T.tertiaryContainer }}>
              <Text style={{ fontFamily: FONT.bold, fontSize: 13, color: T.onTertiaryContainer }}>×2 nu</Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
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

function openNfcSettings() {
  RNLinking.sendIntent("android.settings.NFC_SETTINGS")
    .catch(() => RNLinking.openSettings())
    .catch(() => {});
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
        // Slug ("miyabi") blir "miyabi-01"; en dynamisk tagg ger även SUN (splitTag)
        const tag = splitTag(await readToken());
        if (cancelled || !mountedRef.current) return;
        if (tag) await onSendTap(tag);
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

  // NFC avstängt i telefonen: tydlig ruta med genväg till inställningen.
  if (nfc.supported && !nfc.enabled) {
    return (
      <View style={{ marginHorizontal: 16, marginBottom: 12, paddingVertical: 10, paddingLeft: 16, paddingRight: 8, borderRadius: 16, backgroundColor: T.surface, borderWidth: 1, borderColor: T.outline, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Icon name="nfc" size={22} color={T.inkSoft} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONT.bold, fontSize: 14, color: T.ink }}>NFC är avstängt</Text>
          <Text style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: T.inkSoft }}>Slå på NFC för att kunna stämpla.</Text>
        </View>
        <Pressable onPress={openNfcSettings} accessibilityRole="button" style={{ height: 40, paddingHorizontal: 12, borderRadius: 20, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: FONT.bold, fontSize: 14, color: T.primary }}>Slå på</Text>
        </Pressable>
      </View>
    );
  }

  const checking = nfc.supported === null;
  const unsupported = nfc.supported === false;
  const title = checking ? "Kontrollerar NFC…" : unsupported ? "NFC stöds inte" : "Redo att stämpla";
  const text = unsupported ? "Den här telefonen saknar NFC-läsare." : err || (checking ? "" : "Håll telefonen mot stämpeln i kassan.");

  return (
    <View style={{ marginHorizontal: 16, marginBottom: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 20, backgroundColor: T.container, flexDirection: "row", alignItems: "center", gap: 14 }}>
      <RadarBadge size={40} active={!!nfc.enabled && !unsupported} busy={checking} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: T.ink }}>{title}</Text>
        {!!text && <Text style={{ fontFamily: FONT.regular, fontSize: 14, lineHeight: 19, color: err ? T.errorText : T.inkSoft }}>{text}</Text>}
      </View>
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
      const tag = splitTag(await readToken({ alertMessage: "Håll toppen av iPhonen mot TapPass-stämpeln" }));
      if (tag) {
        await setIosAlert("Stämpel läst");
        await cancelNfc();
        await onSendTap(tag);
      } else {
        await cancelNfc();
        setErr("Ingen TapPass-stämpel hittades. Försök igen.");
      }
    } catch (e) {
      await cancelNfc();
      if (!isCancelOrTimeout(e)) setErr("Läsfel — försök igen.");
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  };

  if (nfc.supported === false) {
    return (
      <View style={{ marginHorizontal: 16, marginBottom: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, backgroundColor: T.container, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Icon name="nfc" size={22} color={T.inkSoft} />
        <Text style={{ flex: 1, fontFamily: FONT.regular, fontSize: 14, lineHeight: 19, color: T.inkSoft }}>Den här enheten saknar NFC-läsare.</Text>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 16, alignItems: "flex-end", gap: 8 }}>
      {!!err && <Text style={{ alignSelf: "stretch", textAlign: "right", fontFamily: FONT.regular, fontSize: 13, color: T.errorText }}>{err}</Text>}
      <Pressable
        onPress={onScan}
        disabled={scanning}
        accessibilityRole="button"
        style={({ pressed }) => ({ height: 56, paddingLeft: 16, paddingRight: 20, borderRadius: 16, backgroundColor: T.primaryContainer, flexDirection: "row", alignItems: "center", gap: 10, opacity: scanning ? 0.75 : pressed ? 0.88 : 1, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 })}
      >
        {scanning
          ? <RadarBadge size={26} active />
          : <Icon name="nfc" size={22} color={T.onPrimaryContainer} />}
        <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: T.onPrimaryContainer }}>{scanning ? "Håll mot stämpeln…" : "Skanna stämpel"}</Text>
      </Pressable>
    </View>
  );
}

function BottomNav({ tab, setTab, wheelReady }) {
  const insets = useSafeAreaInsets();
  const Item = ({ k, label, icon, dot }) => {
    const on = tab === k;
    return (
      <Pressable
        onPress={() => { if (!on) Haptics.selectionAsync(); setTab(k); }}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={dot ? label + ", nytt snurr väntar" : label}
        style={{ flex: 1, alignItems: "center", gap: 4 }}
      >
        <View style={{ width: 64, height: 32, borderRadius: 16, backgroundColor: on ? T.primaryContainer : "transparent", alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={22} color={on ? T.ink : T.inkSoft} />
          {dot && <View style={{ position: "absolute", top: 3, right: 15, width: 10, height: 10, borderRadius: 5, backgroundColor: T.primary, borderWidth: 2, borderColor: on ? T.primaryContainer : T.container }} />}
        </View>
        <Text style={{ fontFamily: on ? FONT.bold : FONT.medium, fontSize: 12, color: on ? T.ink : T.inkSoft }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: T.container, paddingTop: 12, paddingBottom: 16 + insets.bottom }}>
      <Item k="home" label="Kort" icon="card" />
      <Item k="wheel" label="Hjul" icon="wheel" dot={wheelReady && tab !== "wheel"} />
      <Item k="discover" label="Ställen" icon="pin" />
    </View>
  );
}

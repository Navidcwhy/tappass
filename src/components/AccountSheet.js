import React, { useEffect, useRef, useState } from "react";
import { View, Text, Modal, Pressable, Animated, Easing, ScrollView, TextInput, KeyboardAvoidingView, Platform, Linking, Dimensions, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { T, FONT } from "../lib/theme";
import { Icon } from "../lib/icons";
import Shape from "./Shape";
import { PRIVACY_URL, cleanEmail, validEmail, cleanCode, codeReady, resendIn, accountErrorText, linkResultText } from "../lib/account";
import { sendLoginCode, verifyLoginCode, linkAccount, rotateAccountKey, deleteAccount, accountStatus, endAuthSession, setBirthday } from "../lib/supabase";
import { MONTHS, MONTHS_SHORT, daysIn, validBirthday, dateText, birthdayRowText } from "../lib/birthday";

// Konto (v14): spara stämplarna med en kod på e-post. Frivilligt — utan konto finns
// stämplarna bara i telefonen, och det står tydligt här.
//   visible   — arket syns
//   account   — { email } när telefonen är kopplad till ett konto, annars null
//   onChanged — { type: "linked", result, email } | { type: "logout" } | { type: "rotated" } |
//               { type: "deleted" } | { type: "gone" } (utloggad från en annan telefon).
//               Appen sparar läget och hämtar kort och hjul igen.
//   onClose
//   birthday        — birthday_status (v15) för födelsedagsraden; birthdayOn = servern har v15
//   birthdayOffered — något ställe erbjuder födelsedagspresent (nämns i fördelarna)
// Steg: start (e-post) → code → done, och för kopplade telefoner account → confirm (→ code)
// och account → birthday (v15: dag och månad, aldrig året).
const CONFIRM = {
  logout: {
    icon: "logout", title: "Logga ut från den här telefonen?",
    body: () => "Dina stämplar finns kvar på kontot. Telefonen börjar om med tomma kort tills du loggar in igen.",
    action: "Logga ut",
  },
  rotate: {
    icon: "shield", title: "Logga ut andra telefoner?",
    body: (m) => "Alla andra telefoner som är inloggade på kontot loggas ut. Den här telefonen fortsätter som vanligt. Vi mejlar en kod till " + m + " för att bekräfta att det är du.",
    action: "Skicka kod",
  },
  delete: {
    icon: "trash", title: "Radera kontot?",
    body: () => "Kontot och din e-post raderas, och dina stämplar, sparade belöningar och dubbelstämplar försvinner ur appen – på alla dina telefoner. Det går inte att ångra.",
    fine: "Butikerna behåller sin statistik över stämplingar, utan koppling till dig.",
    action: "Skicka kod",
  },
};

export default function AccountSheet({ visible, account, onChanged, onClose, birthday = null, birthdayOn = false, birthdayOffered = false }) {
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  const mounted = useRef(true);
  const [view, setView] = useState("start");
  const [purpose, setPurpose] = useState("login");   // login | logout | rotate | delete
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [verified, setVerified] = useState(false);   // koden godkänd; ett nätfel efteråt försöks igen utan ny kod
  const [result, setResult] = useState(null);
  const [bMonth, setBMonth] = useState(null);       // födelsedagsvyn (v15)
  const [bDay, setBDay] = useState(null);
  const [bNote, setBNote] = useState(null);         // "Sparat. Nästa present …"
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!visible) return;
    setView(account ? "account" : "start");
    setPurpose("login");
    setEmail(account ? account.email : "");
    setCode(""); setError(null); setNotice(null); setVerified(false); setResult(null); setBusy(false); setBNote(null);
    rise.setValue(0);
    Animated.timing(rise, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    if (account) {
      // Utloggad från en annan telefon ("Logga ut andra telefoner") eller raderat konto
      accountStatus().then((s) => {
        if (!mounted.current || !s.ok || s.linked) return;
        setNotice("Du har loggats ut på den här telefonen. Logga in igen för att se dina stämplar.");
        setView("start");
        if (onChanged) onChanged({ type: "gone" });
      });
    }
  }, [visible]);

  // Nedräkningen för "Skicka ny kod"
  useEffect(() => {
    if (!visible || view !== "code") return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible, view]);

  if (!visible) return null;

  const close = () => { endAuthSession(); if (onClose) onClose(); };
  const fail = (r) => { setError(accountErrorText(r)); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); };
  const go = (v, p) => { Haptics.selectionAsync(); setError(null); if (p) setPurpose(p); setView(v); };

  const sendCode = async () => {
    if (busy) return;
    const addr = cleanEmail(email);
    if (!validEmail(addr)) { fail("invalid_email"); return; }
    setBusy(true); setError(null);
    const r = await sendLoginCode(addr, { create: purpose === "login" });
    if (!mounted.current) return;
    setBusy(false);
    if (!r.ok) { fail(r); return; }
    Haptics.selectionAsync();
    setEmail(addr); setCode(""); setVerified(false);
    setSentAt(Date.now()); setNow(Date.now());
    setView("code");
  };

  // Efter godkänd kod: koppla telefonen, byt nyckel eller radera
  const afterVerify = async () => {
    if (purpose === "login") {
      const l = await linkAccount();
      if (!mounted.current) return;
      setBusy(false);
      if (!l.ok) { fail(l); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setVerified(false); setResult(l); setView("done");
      if (onChanged) onChanged({ type: "linked", result: l, email: cleanEmail(email) });
      return;
    }
    const r = purpose === "rotate" ? await rotateAccountKey() : await deleteAccount();
    if (!mounted.current) return;
    setBusy(false);
    if (!r.ok) { fail(r); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (onChanged) onChanged({ type: purpose === "rotate" ? "rotated" : "deleted" });
    if (onClose) onClose();
  };

  const confirmCode = async () => {
    if (busy) return;
    if (!verified) {
      if (!codeReady(code)) return;
      setBusy(true); setError(null);
      const v = await verifyLoginCode(email, code);
      if (!mounted.current) return;
      if (!v.ok) { setBusy(false); fail(v); return; }
      setVerified(true);
    } else {
      setBusy(true); setError(null);
    }
    await afterVerify();
  };

  // Födelsedagen (v15): öppna väljaren med sparat datum, spara eller ta bort
  const openBirthday = () => {
    const b = birthday && birthday.birthday;
    setBMonth(b ? Number(b.month) : null);
    setBDay(b ? Number(b.day) : null);
    setBNote(null);
    go("birthday");
  };
  const saveBirthday = async (remove) => {
    if (busy) return;
    if (!remove && !validBirthday(bMonth, bDay)) return;
    setBusy(true); setError(null);
    const r = await setBirthday(remove ? null : bMonth, remove ? null : bDay);
    if (!mounted.current) return;
    setBusy(false);
    if (!r.ok) { fail(r.error === "not_linked" ? "not_linked" : r); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setBNote(remove ? "Födelsedagen är borttagen." : "Sparat." + (r.next_gift ? " Nästa present: " + dateText(r.next_gift) + "." : ""));
    setView("account");
    if (onChanged) onChanged({ type: "birthday", result: r });
  };

  const logout = () => {
    Haptics.selectionAsync();
    if (onChanged) onChanged({ type: "logout" });
    if (onClose) onClose();
  };

  // Kundens egen adress (sparad på telefonen vid inloggningen)
  const shown = account && account.email ? account.email : cleanEmail(email);
  const wait = resendIn(sentAt, now);
  const conf = CONFIRM[purpose];

  let body = null;
  if (view === "start") {
    body = (
      <>
        <Hero kind="cookie12" color={T.primaryContainer} icon="cloudCheck" />
        <Title>Spara dina stämplar</Title>
        {!!notice && <Note text={notice} />}
        <Body>Utan konto finns dina stämplar bara i den här telefonen. Tappar du bort den eller installerar om appen är de borta.</Body>
        <View style={{ marginTop: 16, gap: 10 }}>
          <Benefit icon="cloudCheck" text="Stämplarna sparas på kontot" />
          <Benefit icon="phone" text="Samma kort på alla dina telefoner" />
          <Benefit icon="mail" text="Inget lösenord – du loggar in med en kod på e-post" />
          {birthdayOffered && <Benefit icon="cake" text="Present på födelsedagen där det erbjuds" />}
        </View>
        <Field label="E-post" value={email} onChangeText={(s) => { setEmail(s); setError(null); }} onSubmitEditing={sendCode}
          placeholder="namn@exempel.se" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
        {!!error && <ErrorBox text={error} />}
        <Button label="Skicka kod" onPress={sendCode} busy={busy} disabled={!validEmail(email)} />
        <Text style={{ marginTop: 14, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19, color: T.inkSoft, textAlign: "center" }}>
          Vi använder e-posten bara för inloggningen. Kontot är frivilligt och kan raderas när du vill.{" "}
          <Text accessibilityRole="link" onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})} style={{ fontFamily: FONT.semibold, color: T.primary }}>Integritetspolicy</Text>
        </Text>
        <TextButton label="Inte nu" onPress={close} />
      </>
    );
  } else if (view === "code") {
    const login = purpose === "login";
    body = (
      <>
        <Hero kind="sunny8" color={T.tertiaryContainer} icon="mailCheck" iconColor={T.onTertiaryContainer} />
        <Title>{login ? "Skriv in koden" : purpose === "delete" ? "Bekräfta raderingen" : "Bekräfta att det är du"}</Title>
        <Body>Vi har mejlat en kod till {email}. Hittar du inte mejlet? Titta i skräpposten.</Body>
        <TextInput
          value={code}
          onChangeText={(s) => { setCode(cleanCode(s)); setError(null); }}
          onSubmitEditing={confirmCode}
          editable={!verified && !busy}
          autoFocus
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === "ios" ? "one-time-code" : "sms-otp"}
          maxLength={10}
          placeholder="••••••"
          placeholderTextColor={T.outline}
          accessibilityLabel="Kod från mejlet"
          style={{ marginTop: 18, height: 68, borderRadius: 20, backgroundColor: T.surface, borderWidth: 2, borderColor: codeReady(code) ? T.primary : T.outline, fontFamily: FONT.display, fontSize: 32, letterSpacing: 10, color: T.ink, textAlign: "center", paddingVertical: 0 }}
        />
        {!!error && <ErrorBox text={error} />}
        <Button
          label={verified ? "Försök igen" : login ? "Logga in" : purpose === "delete" ? "Radera kontot" : "Logga ut andra telefoner"}
          onPress={confirmCode} busy={busy} disabled={!verified && !codeReady(code)} danger={purpose === "delete"}
        />
        <View style={{ marginTop: 6, flexDirection: "row", justifyContent: "center", flexWrap: "wrap", columnGap: 8 }}>
          <TextButton label={wait > 0 ? "Skicka ny kod om " + wait + " s" : "Skicka ny kod"} onPress={sendCode} disabled={wait > 0 || busy || verified} />
          {login
            ? <TextButton label="Ändra e-post" onPress={() => { endAuthSession(); go("start"); }} disabled={busy} />
            : <TextButton label="Avbryt" onPress={() => { endAuthSession(); go("account"); }} disabled={busy} />}
        </View>
      </>
    );
  } else if (view === "done") {
    const t = linkResultText(result);
    body = (
      <>
        <Hero kind="cookie9" color={T.lime} icon="check" iconColor={T.onPrimaryContainer} />
        <Title>{t.title}</Title>
        <Body>{t.body}</Body>
        <View style={{ marginTop: 16, padding: 14, borderRadius: 20, backgroundColor: T.container, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Icon name="user" size={22} color={T.ink} />
          <Text style={{ flex: 1, fontFamily: FONT.medium, fontSize: 15, color: T.ink }}>Inloggad som {shown}</Text>
        </View>
        {birthdayOn && !(birthday && birthday.birthday) && <Button label="Lägg till födelsedag" onPress={openBirthday} tonal />}
        <Button label="Klar" onPress={close} />
      </>
    );
  } else if (view === "account") {
    body = (
      <>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Shape kind="cookie9" size={64} color={T.primaryContainer}>
            <Icon name="user" size={28} color={T.onPrimaryContainer} />
          </Shape>
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={{ fontFamily: FONT.title, fontSize: 24, lineHeight: 30, color: T.ink }}>Ditt konto</Text>
            <Text style={{ fontFamily: FONT.regular, fontSize: 15, lineHeight: 20, color: T.inkSoft }}>Inloggad som {shown}</Text>
          </View>
        </View>
        <View style={{ marginTop: 16, padding: 14, borderRadius: 20, backgroundColor: T.primaryContainer, flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <Icon name="cloudCheck" size={22} color={T.onPrimaryContainer} />
          <Text style={{ flex: 1, fontFamily: FONT.regular, fontSize: 15, lineHeight: 21, color: T.onPrimaryContainer }}>
            Dina stämplar sparas på kontot. Logga in med samma e-post på en ny telefon så följer de med.
          </Text>
        </View>
        {!!bNote && <Note text={bNote} icon="check" />}
        <View style={{ marginTop: 14, borderRadius: 24, backgroundColor: T.surface, borderWidth: 1, borderColor: T.hairline, overflow: "hidden" }}>
          {birthdayOn && <Action icon="cake" title="Födelsedag" sub={birthdayRowText(birthday)} onPress={openBirthday} />}
          <Action icon="logout" title="Logga ut från den här telefonen" sub="Stämplarna finns kvar på kontot" onPress={() => go("confirm", "logout")} />
          <Action icon="shield" title="Logga ut andra telefoner" sub="Om du tappat bort en telefon" onPress={() => go("confirm", "rotate")} />
          <Action icon="trash" title="Radera konto" danger onPress={() => go("confirm", "delete")} />
        </View>
        <Button label="Stäng" onPress={close} tonal />
      </>
    );
  } else if (view === "birthday") {
    const max = bMonth ? daysIn(bMonth) : 31;
    const had = !!(birthday && birthday.birthday);
    body = (
      <>
        <Hero kind="flower8" color="#F2AFC4" icon="cake" iconColor={T.onTertiaryContainer} />
        <Title>Din födelsedag</Title>
        <Body>Ställen som erbjuder en födelsedagspresent ger dig den på din födelsedag – den gäller i en vecka. Vi sparar bara dag och månad, inte året.</Body>
        <Text style={{ marginTop: 18, marginLeft: 4, marginBottom: 8, fontFamily: FONT.semibold, fontSize: 14, color: T.inkSoft }}>Månad</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
          {MONTHS_SHORT.map((m, i) => {
            const on = bMonth === i + 1;
            return (
              <Pressable key={m} onPress={() => { Haptics.selectionAsync(); setBMonth(i + 1); if (bDay && bDay > daysIn(i + 1)) setBDay(null); }}
                accessibilityRole="button" accessibilityLabel={MONTHS[i]} accessibilityState={{ selected: on }}
                style={{ height: 40, minWidth: 52, paddingHorizontal: 12, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: on ? T.primary : T.surface, borderWidth: on ? 0 : 1, borderColor: T.outline }}>
                <Text style={{ fontFamily: on ? FONT.bold : FONT.medium, fontSize: 15, color: on ? "#FFFFFF" : T.ink }}>{m}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={{ marginTop: 16, marginLeft: 4, marginBottom: 8, fontFamily: FONT.semibold, fontSize: 14, color: T.inkSoft }}>Dag</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((dd) => {
            const on = bDay === dd;
            const off = dd > max;
            return (
              <Pressable key={dd} onPress={off ? undefined : () => { Haptics.selectionAsync(); setBDay(dd); }}
                accessibilityRole="button" accessibilityLabel={String(dd)} accessibilityState={{ selected: on, disabled: off }}
                style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: on ? T.primary : off ? "transparent" : T.surface, borderWidth: on || off ? 0 : 1, borderColor: T.hairline }}>
                <Text style={{ fontFamily: on ? FONT.bold : FONT.medium, fontSize: 15, color: on ? "#FFFFFF" : off ? T.outline : T.ink }}>{dd}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={{ marginTop: 12, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19, color: T.inkSoft, textAlign: "center" }}>
          Spara den minst 30 dagar i förväg för att få presenten samma år.
        </Text>
        {!!error && <ErrorBox text={error} />}
        <Button label={validBirthday(bMonth, bDay) ? "Spara " + bDay + " " + MONTHS[bMonth - 1] : "Spara"} onPress={() => saveBirthday(false)} busy={busy} disabled={!validBirthday(bMonth, bDay)} />
        <View style={{ flexDirection: "row", justifyContent: "center", columnGap: 8 }}>
          {had && <TextButton label="Ta bort födelsedag" onPress={() => saveBirthday(true)} disabled={busy} />}
          <TextButton label="Avbryt" onPress={() => go("account")} disabled={busy} />
        </View>
      </>
    );
  } else if (view === "confirm" && conf) {
    const danger = purpose === "delete";
    const needEmail = purpose !== "logout" && !(account && account.email);
    body = (
      <>
        <Hero kind="cookie9" color={danger ? T.errorContainer : T.container} icon={conf.icon} iconColor={danger ? T.onErrorContainer : T.ink} />
        <Title>{conf.title}</Title>
        <Body>{conf.body(shown || "din e-post")}</Body>
        {!!conf.fine && <Text style={{ marginTop: 8, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19, color: T.inkSoft, textAlign: "center" }}>{conf.fine}</Text>}
        {needEmail && (
          <Field label="E-post" value={email} onChangeText={(s) => { setEmail(s); setError(null); }} onSubmitEditing={sendCode}
            placeholder="namn@exempel.se" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
        )}
        {!!error && <ErrorBox text={error} />}
        <Button label={conf.action} onPress={purpose === "logout" ? logout : sendCode} busy={busy} danger={danger}
          disabled={needEmail && !validEmail(email)} />
        <TextButton label="Avbryt" onPress={() => go("account")} disabled={busy} />
      </>
    );
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={busy ? () => {} : close}>
      {/* "padding" även på Android: ett genomskinligt Modal-fönster ändrar inte alltid storlek när tangentbordet kommer */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityLabel="Stäng" onPress={busy ? undefined : close} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: T.scrim }} />
        <Animated.View style={{
          maxHeight: Dimensions.get("window").height * 0.92,
          backgroundColor: T.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
        }}>
          <View style={{ alignItems: "center", paddingTop: 10 }}>
            <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: T.outline }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 + insets.bottom }}>
            {body}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Hero({ kind, color, icon, iconColor = T.onPrimaryContainer }) {
  return (
    <View style={{ alignItems: "center", marginTop: 4 }}>
      <Shape kind={kind} size={84} color={color}>
        <Icon name={icon} size={36} color={iconColor} strokeWidth={2} />
      </Shape>
    </View>
  );
}

const Title = ({ children }) => (
  <Text accessibilityRole="header" style={{ marginTop: 14, fontFamily: FONT.title, fontSize: 26, lineHeight: 32, color: T.ink, textAlign: "center" }}>{children}</Text>
);

const Body = ({ children }) => (
  <Text style={{ marginTop: 8, fontFamily: FONT.regular, fontSize: 16, lineHeight: 23, color: T.inkSoft, textAlign: "center" }}>{children}</Text>
);

function Note({ text, icon = "info" }) {
  return (
    <View style={{ marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: T.tertiaryContainer, flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <Icon name={icon} size={20} color={T.onTertiaryContainer} />
      <Text style={{ flex: 1, fontFamily: FONT.medium, fontSize: 14, lineHeight: 20, color: T.onTertiaryContainer }}>{text}</Text>
    </View>
  );
}

function Benefit({ icon, text }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: T.container, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} color={T.ink} />
      </View>
      <Text style={{ flex: 1, fontFamily: FONT.medium, fontSize: 15, lineHeight: 20, color: T.ink }}>{text}</Text>
    </View>
  );
}

function Field({ label, ...input }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ marginLeft: 4, marginBottom: 6, fontFamily: FONT.semibold, fontSize: 14, color: T.inkSoft }}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="send"
        placeholderTextColor={T.inkMute}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{ height: 56, borderRadius: 16, paddingHorizontal: 16, backgroundColor: T.surface, borderWidth: focus ? 2 : 1, borderColor: focus ? T.primary : T.outline, fontFamily: FONT.regular, fontSize: 17, color: T.ink, paddingVertical: 0 }}
      />
    </View>
  );
}

function ErrorBox({ text }) {
  return (
    <View accessibilityLiveRegion="polite" style={{ marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: T.errorContainer, flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <Icon name="alert" size={20} color={T.onErrorContainer} />
      <Text style={{ flex: 1, fontFamily: FONT.medium, fontSize: 14, lineHeight: 20, color: T.onErrorContainer }}>{text}</Text>
    </View>
  );
}

function Button({ label, onPress, busy, disabled, danger, tonal }) {
  const off = disabled || busy;
  const bg = danger ? T.error : tonal ? T.secondaryContainer : T.primary;
  const fg = tonal ? T.onSecondaryContainer : "#FFFFFF";
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => ({ marginTop: 18, height: 54, borderRadius: 27, backgroundColor: bg, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, opacity: disabled && !busy ? 0.45 : pressed ? 0.88 : 1 })}
    >
      {busy && <ActivityIndicator size="small" color={fg} />}
      <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: fg }}>{label}</Text>
    </Pressable>
  );
}

function TextButton({ label, onPress, disabled }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={{ marginTop: 6, minHeight: 44, paddingHorizontal: 12, alignSelf: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: disabled ? T.inkMute : T.primary }}>{label}</Text>
    </Pressable>
  );
}

function Action({ icon, title, sub, onPress, danger }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: T.hairline, marginTop: -1, backgroundColor: pressed ? T.container : "transparent" })}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: danger ? T.errorContainer : T.container, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} color={danger ? T.onErrorContainer : T.ink} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20, color: danger ? T.error : T.ink }}>{title}</Text>
        {!!sub && <Text style={{ marginTop: 2, fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: T.inkSoft }}>{sub}</Text>}
      </View>
      <Icon name="chev" size={18} color={T.inkMute} />
    </Pressable>
  );
}

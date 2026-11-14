import React, { useEffect, useRef, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { T, FONT } from "../lib/theme";
import { Icon } from "../lib/icons";
import Shape from "./Shape";
import RadarBadge from "./RadarBadge";
import { openIsoDep, cancelNfc } from "../lib/nfc";
import { useNfcStatus } from "../lib/useNfcStatus";
import { parseIssuedKeys, parseErrorText, maskKey, programTag, resetTag, programErrorText, PROGRAM_STEPS, RESET_STEPS } from "../lib/ntag424";

const ANDROID = Platform.OS === "android";
const uidText = (uid) => String(uid || "").toUpperCase().replace(/(..)(?=.)/g, "$1 ");

// Taggverktyget (v17): gör en NTAG 424 DNA till en dynamisk stämpel — eller återställer en.
// Bara för TapPass: kräver nycklarna från admin_sdm_issue_keys. Öppnas med tappass://programmera
// eller genom att hålla på bilden i hjälpen i tre sekunder (Android).
// Nycklarna finns bara i komponentens minne. De sparas inte och försvinner när verktyget stängs
// och när en tagg är klar (en andra tagg får aldrig samma nycklar).
export default function TagProgrammer({ visible, onClose }) {
  if (!visible) return null;
  return <Programmer onClose={onClose} />;
}

function Programmer({ onClose }) {
  const insets = useSafeAreaInsets();
  const nfc = useNfcStatus();
  const [mode, setMode] = useState("program");   // program | reset
  const [text, setText] = useState("");
  const [phase, setPhase] = useState("idle");    // idle | waiting | working | done | error
  const [step, setStep] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [slow, setSlow] = useState(false);
  const alive = useRef(true);
  const run = useRef(0);

  useEffect(() => () => { alive.current = false; run.current++; cancelNfc(); }, []);
  useEffect(() => {
    if (phase !== "waiting") { setSlow(false); return undefined; }
    const t = setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(t);
  }, [phase]);

  const parsed = parseIssuedKeys(text);
  const steps = mode === "reset" ? RESET_STEPS : PROGRAM_STEPS;
  const busy = phase === "waiting" || phase === "working";
  const nfcOff = nfc.supported === false || nfc.enabled === false;

  const start = async () => {
    if (busy || !parsed.ok || nfcOff) return;
    const id = ++run.current;
    const current = () => alive.current && run.current === id;
    const cfg = { token: parsed.token, k0: parsed.k0, k1: parsed.k1, k2: parsed.k2 };
    const job = mode === "reset" ? resetTag : programTag;
    setError(null); setResult(null); setStep(null); setPhase("waiting");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await cancelNfc();
    let tx;
    try { tx = await openIsoDep(); }
    catch { if (current()) setPhase("idle"); return; }   // avbrutet
    if (!current()) { cancelNfc(); return; }
    setPhase("working");
    try {
      const r = await job(tx, cfg, (s) => { if (current()) setStep(s); });
      if (!current()) return;
      setResult(mode === "reset" ? { reset: true, token: cfg.token } : r);
      setPhase("done");
      setText("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      if (!current()) return;
      setError(programErrorText(e));
      setPhase("error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      cancelNfc();
    }
  };
  const stop = () => { run.current++; cancelNfc(); setPhase("idle"); setStep(null); };
  const again = () => { setMode("program"); setPhase("idle"); setResult(null); setError(null); setStep(null); setText(""); };
  const close = () => { run.current++; cancelNfc(); onClose(); };
  const pickMode = (m) => { if (busy) return; setMode(m); setPhase("idle"); setError(null); setResult(null); setStep(null); };

  const round = (pressed) => ({ width: 48, height: 48, borderRadius: 24, backgroundColor: T.container, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.8 : 1 });
  const card = { marginTop: 16, padding: 16, borderRadius: 24, backgroundColor: T.surface, borderWidth: 1, borderColor: T.hairline };
  const primaryBtn = (enabled) => ({ pressed }) => ({ marginTop: 14, height: 56, borderRadius: 28, backgroundColor: T.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, opacity: !enabled ? 0.45 : pressed ? 0.88 : 1 });

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={busy ? stop : close}>
      <View style={{ flex: 1, backgroundColor: T.bg, paddingTop: insets.top }}>
        <View style={{ paddingLeft: 20, paddingRight: 12, paddingTop: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, fontFamily: FONT.title, fontSize: 28, lineHeight: 34, color: T.ink }}>Programmera stämpel</Text>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Stäng" style={({ pressed }) => round(pressed)}>
            <Icon name="close" size={22} color={T.ink} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 + insets.bottom }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Shape kind="cookie9" size={64} color={T.primaryContainer}>
              <Icon name="tag" size={28} color={T.onPrimaryContainer} />
            </Shape>
            <Text style={{ flex: 1, fontFamily: FONT.regular, fontSize: 15, lineHeight: 21, color: T.inkSoft }}>
              Gör en NTAG 424 DNA-tagg till en dynamisk TapPass-stämpel. För TapPass – kräver nycklarna från admin_sdm_issue_keys.
            </Text>
          </View>

          {!ANDROID ? (
            <View style={[card, { flexDirection: "row", gap: 12 }]}>
              <Icon name="phone" size={22} color={T.inkSoft} />
              <Text style={{ flex: 1, fontFamily: FONT.medium, fontSize: 15, lineHeight: 21, color: T.ink }}>
                Programmeringen kräver en Android-telefon med NFC. En iPhone kan inte skriva till taggen från appen.
              </Text>
            </View>
          ) : phase === "done" && result ? (
            <Done result={result} card={card} onAgain={again} onClose={close} primaryBtn={primaryBtn} />
          ) : (
            <>
              <View accessibilityRole="tablist" style={{ marginTop: 18, flexDirection: "row", gap: 8 }}>
                {[["program", "Programmera"], ["reset", "Återställ"]].map(([id, label]) => {
                  const on = mode === id;
                  return (
                    <Pressable key={id} onPress={() => pickMode(id)} accessibilityRole="tab" accessibilityState={{ selected: on, disabled: busy }}
                      style={{ height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: on ? T.secondaryContainer : "transparent", borderWidth: on ? 0 : 1, borderColor: T.outline, flexDirection: "row", alignItems: "center", gap: 6, opacity: busy && !on ? 0.5 : 1 }}>
                      {on && <Icon name="check" size={16} color={T.onSecondaryContainer} />}
                      <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: on ? T.onSecondaryContainer : T.inkSoft }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={card}>
                <SectionTitle n={1} title="Nycklar" />
                {!parsed.ok && (
                  <>
                    <Text style={{ marginTop: 6, fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: T.inkSoft }}>
                      {mode === "reset"
                        ? "Klistra in taggens nuvarande nycklar (frågan för befintliga nycklar i README-v17-ntag424.md)."
                        : "Klistra in hela resultatet av admin_sdm_issue_keys från Supabase SQL Editor."}
                    </Text>
                    <TextInput
                      value={text}
                      onChangeText={setText}
                      multiline
                      autoCorrect={false}
                      autoCapitalize="none"
                      spellCheck={false}
                      autoComplete="off"
                      importantForAutofill="no"
                      keyboardType={ANDROID ? "visible-password" : "default"}
                      textAlignVertical="top"
                      placeholder="Klistra in här"
                      placeholderTextColor={T.inkMute}
                      accessibilityLabel="Resultatet från admin_sdm_issue_keys"
                      style={{ marginTop: 10, minHeight: 96, maxHeight: 160, padding: 12, borderRadius: 16, backgroundColor: T.bg, borderWidth: 2, borderColor: T.outline, fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: T.ink }}
                    />
                  </>
                )}
                {parsed.ok ? (
                  // Inklistrat och tolkat: texten (med nycklarna) visas inte längre
                  <View accessibilityLiveRegion="polite" style={{ marginTop: 10, padding: 12, borderRadius: 16, backgroundColor: T.primaryContainer, gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Icon name="check" size={18} color={T.onPrimaryContainer} strokeWidth={3} />
                      <Text style={{ flex: 1, fontFamily: FONT.bold, fontSize: 15, color: T.onPrimaryContainer }}>{parsed.token}</Text>
                      {!busy && (
                        <Pressable onPress={() => { setText(""); setPhase("idle"); setError(null); }} accessibilityRole="button" accessibilityLabel="Byt nycklar" hitSlop={8} style={{ minHeight: 32, paddingHorizontal: 8, justifyContent: "center" }}>
                          <Text style={{ fontFamily: FONT.bold, fontSize: 14, color: T.primary }}>Byt</Text>
                        </Pressable>
                      )}
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {[parsed.k0, parsed.k1, parsed.k2].map((k, i) => (
                        <View key={i} style={{ paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: T.surface, flexDirection: "row", alignItems: "center", gap: 5 }}>
                          <Icon name="key" size={14} color={T.inkSoft} />
                          <Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: T.ink }}>{"Nyckel " + i + " " + maskKey(k)}</Text>
                        </View>
                      ))}
                    </View>
                    {mode === "program" && <Text numberOfLines={2} style={{ fontFamily: FONT.regular, fontSize: 12, lineHeight: 16, color: T.onPrimaryContainer }}>{parsed.url}</Text>}
                  </View>
                ) : !!parseErrorText(parsed) && (
                  <View accessibilityLiveRegion="polite" style={{ marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: T.errorContainer, flexDirection: "row", gap: 10 }}>
                    <Icon name="alert" size={20} color={T.onErrorContainer} />
                    <Text style={{ flex: 1, fontFamily: FONT.medium, fontSize: 14, lineHeight: 20, color: T.onErrorContainer }}>{parseErrorText(parsed)}</Text>
                  </View>
                )}
                <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
                  <Icon name="shield" size={16} color={T.inkMute} />
                  <Text style={{ flex: 1, fontFamily: FONT.regular, fontSize: 12, lineHeight: 17, color: T.inkMute }}>
                    Nycklarna sparas aldrig och raderas när du stänger. Kör inte admin_sdm_issue_keys igen för en tagg du redan programmerat – då skrivs nycklarna över.
                  </Text>
                </View>
              </View>

              <View style={card}>
                <SectionTitle n={2} title={mode === "reset" ? "Återställ taggen" : "Programmera taggen"} />
                {busy ? (
                  <>
                    <View accessibilityLiveRegion="polite" style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 14 }}>
                      <RadarBadge size={44} active busy={phase === "working"} />
                      <Text style={{ flex: 1, fontFamily: FONT.semibold, fontSize: 15, lineHeight: 21, color: T.ink }}>
                        {phase === "waiting" ? "Håll taggen mot mitten av telefonens baksida." : "Håll stilla …"}
                      </Text>
                    </View>
                    {slow && (
                      <Text style={{ marginTop: 10, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19, color: T.inkSoft }}>
                        Händer inget? Taggen måste vara en NTAG 424 DNA. Flytta den långsamt över telefonens baksida – läsaren sitter ofta nära kameran.
                      </Text>
                    )}
                    <Steps steps={steps} current={phase === "working" ? step : null} />
                    <Pressable onPress={stop} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 14, height: 48, borderRadius: 24, backgroundColor: T.container, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}>
                      <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: T.ink }}>Avbryt</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    {!!error && (
                      <View accessibilityLiveRegion="polite" style={{ marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: T.errorContainer, flexDirection: "row", gap: 10 }}>
                        <Icon name="alert" size={20} color={T.onErrorContainer} />
                        <Text style={{ flex: 1, fontFamily: FONT.medium, fontSize: 14, lineHeight: 20, color: T.onErrorContainer }}>{error}</Text>
                      </View>
                    )}
                    {nfcOff && (
                      <Text style={{ marginTop: 12, fontFamily: FONT.medium, fontSize: 14, lineHeight: 20, color: T.errorText }}>
                        {nfc.supported === false ? "Den här telefonen saknar NFC-läsare." : "NFC är avstängt. Slå på NFC i telefonens inställningar."}
                      </Text>
                    )}
                    <Pressable onPress={start} accessibilityRole="button" accessibilityState={{ disabled: !parsed.ok || nfcOff }} style={primaryBtn(parsed.ok && !nfcOff)}>
                      <Icon name={mode === "reset" ? "reset" : "nfc"} size={20} color={T.onPrimary} />
                      <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: T.onPrimary }}>
                        {phase === "error" ? "Försök igen" : mode === "reset" ? "Återställ taggen" : "Programmera taggen"}
                      </Text>
                    </Pressable>
                    <Text style={{ marginTop: 10, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19, color: T.inkSoft }}>
                      {mode === "reset"
                        ? "Taggen går tillbaka till fabriksläget: nycklarna blir nollor och den dynamiska adressen stängs av. Därefter kan den programmeras med nya nycklar."
                        : "Tar några sekunder. Bryts kontakten fortsätter programmeringen där den slutade när du försöker igen."}
                    </Text>
                  </>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function SectionTitle({ n, title }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Shape kind="cookie9" size={28} color={T.primary}>
        <Text style={{ fontFamily: FONT.bold, fontSize: 13, color: T.onPrimary }}>{n}</Text>
      </Shape>
      <Text style={{ flex: 1, fontFamily: FONT.title, fontSize: 18, color: T.ink }}>{title}</Text>
    </View>
  );
}

function Steps({ steps, current }) {
  const at = steps.findIndex((s) => s.id === current);
  return (
    <View style={{ marginTop: 14, gap: 10 }}>
      {steps.map((s, i) => {
        const done = at > i, active = at === i;
        return (
          <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }} accessibilityLabel={s.label + (done ? ", klart" : active ? ", pågår" : "")}>
            <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: done ? T.primary : active ? T.primaryContainer : "transparent", borderWidth: done || active ? 0 : 2, borderColor: T.outline }}>
              {done ? <Icon name="check" size={14} color={T.onPrimary} strokeWidth={3} /> : active ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.primary }} /> : null}
            </View>
            <Text style={{ flex: 1, fontFamily: active ? FONT.semibold : FONT.regular, fontSize: 14, color: done || active ? T.ink : T.inkMute }}>{s.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Done({ result, card, onAgain, onClose, primaryBtn }) {
  const reset = !!result.reset;
  const next = [
    "Testa: stämpla en gång med TapPass-appen och kontrollera admin_sdm_status i SQL Editor.",
    "Sätt upp taggen i kassan och ta bort den gamla.",
    "När alla har appuppdateringen: admin_sdm_enforce('" + result.token + "') – då fungerar bara den nya taggen.",
  ];
  return (
    <>
      <View accessibilityLiveRegion="polite" style={{ marginTop: 18, paddingVertical: 24, paddingHorizontal: 20, borderRadius: 28, backgroundColor: T.primaryContainer, alignItems: "center" }}>
        <Shape kind="burst12" size={88} color={T.primary}>
          <Icon name="check" size={40} color={T.onPrimary} strokeWidth={3} />
        </Shape>
        <Text accessibilityRole="header" style={{ marginTop: 14, fontFamily: FONT.title, fontSize: 24, lineHeight: 30, color: T.onPrimaryContainer, textAlign: "center" }}>
          {reset ? "Taggen är återställd" : "Klart – stämpeln är dynamisk"}
        </Text>
        <Text style={{ marginTop: 6, fontFamily: FONT.medium, fontSize: 15, lineHeight: 21, color: T.onPrimaryContainer, textAlign: "center" }}>
          {reset ? "Fabriksläge: nycklarna är nollor och den dynamiska adressen är avstängd." : result.token}
        </Text>
        {!reset && (
          <Text style={{ marginTop: 4, fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: T.onPrimaryContainer, textAlign: "center" }}>
            {"UID " + uidText(result.uid) + " · läsräknare " + result.counter}
          </Text>
        )}
      </View>
      {!reset && (
        <View style={card}>
          <Text style={{ fontFamily: FONT.title, fontSize: 17, color: T.ink }}>Sedan</Text>
          {next.map((t, i) => (
            <View key={i} style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
              <Shape kind="cookie9" size={22} color={T.secondaryContainer}>
                <Text style={{ fontFamily: FONT.bold, fontSize: 11, color: T.onSecondaryContainer }}>{i + 1}</Text>
              </Shape>
              <Text style={{ flex: 1, fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: T.inkSoft }}>{t}</Text>
            </View>
          ))}
          <Text style={{ marginTop: 12, fontFamily: FONT.regular, fontSize: 12, lineHeight: 17, color: T.inkMute }}>
            Ta bort taggen från telefonen innan du stänger – annars stämplar appen med den direkt.
          </Text>
        </View>
      )}
      <Pressable onPress={onAgain} accessibilityRole="button" style={primaryBtn(true)}>
        <Icon name="tag" size={20} color={T.onPrimary} />
        <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: T.onPrimary }}>{reset ? "Programmera en tagg" : "Programmera nästa tagg"}</Text>
      </Pressable>
      <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 10, height: 52, borderRadius: 26, backgroundColor: T.container, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: T.ink }}>Stäng</Text>
      </Pressable>
    </>
  );
}

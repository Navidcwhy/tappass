import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Animated, Easing, Modal, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";
import { TAG_REGISTRY } from "../lib/registry";
import { T, RADIUS, FONT } from "../lib/theme";
import { Icon, CafeIcon } from "../lib/icons";
import { initNfc, isNfcSupported, isNfcEnabled, readToken, cancelNfc } from "../lib/nfc";
import LoyaltyCard from "./LoyaltyCard";

export default function ScanSheet({ visible, onClose, onStampedCard, onFinish, wallet }) {
  const [phase, setPhase] = useState("ready");
  const [card, setCard] = useState(null);
  const [nfcStatus, setNfcStatus] = useState("");
  const [nfcOk, setNfcOk] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPhase("ready"); setCard(null); setNfcStatus("");
    (async () => {
      const ok = await initNfc();
      if (!ok) { setNfcOk(false); setNfcStatus("NFC ej tillgängligt."); return; }
      const supported = await isNfcSupported();
      if (!supported) { setNfcOk(false); setNfcStatus("NFC stöds inte."); return; }
      const enabled = await isNfcEnabled();
      setNfcOk(true);
      if (!enabled) { setNfcStatus("Slå på NFC i snabbinställningarna."); return; }
      scanReal();
    })();
    return () => { cancelNfc(); };
  }, [visible]);

  const stampWith = (biz) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const ex = wallet[biz.id];
    let stamps = ex ? ex.stamps + 1 : 1;
    let times = ex ? [...ex.times] : [];
    if (stamps > biz.needed) { stamps = 1; times = []; }
    const now = new Date();
    const t = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    times.push(t);
    const newCard = { ...biz, stamps, times };
    setCard(newCard);
    setPhase("result");
    onStampedCard(newCard);
  };

  const scanReal = async () => {
    if (!nfcOk) return;
    setNfcStatus("");
    try {
      const token = await readToken();
      if (!token) { setNfcStatus("Kunde inte läsa taggen."); setTimeout(scanReal, 600); return; }
      const biz = TAG_REGISTRY[token];
      if (!biz) { setNfcStatus("Okänd tagg: " + token); setTimeout(scanReal, 1200); return; }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      stampWith(biz);
    } catch (e) {
      const msg = (e && e.message) || "";
      if (/cancel/i.test(msg)) return;
      setNfcStatus("Läsfel — försök igen.");
      setTimeout(scanReal, 800);
    } finally { cancelNfc(); }
  };

  const simulate = (id) => stampWith(TAG_REGISTRY[id]);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(26,22,18,.72)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: T.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 30 }}>
          <View style={{ width: 42, height: 5, backgroundColor: T.hairline, borderRadius: 10, alignSelf: "center", marginBottom: 18 }} />

          {phase === "ready" && (
            <View style={{ paddingBottom: 10 }}>
              <Scanner />
              <Text style={{ fontFamily: FONT.display, fontSize: 30, color: T.ink, textAlign: "center", marginTop: 18 }}>
                {nfcOk ? "Håll mot taggen" : "Aktivera NFC"}
              </Text>
              <Text style={{ fontFamily: FONT.ui, fontSize: 14, color: T.inkMute, textAlign: "center", marginTop: 6 }}>
                Stämpel läggs till automatiskt
              </Text>
              {!!nfcStatus && <Text style={{ fontFamily: FONT.ui, fontSize: 13, color: nfcOk ? T.inkMute : T.err, textAlign: "center", marginTop: 12 }}>{nfcStatus}</Text>}

              <Text style={{ fontFamily: FONT.uiMed, fontSize: 10, color: T.inkFaint, letterSpacing: 1.4, textAlign: "center", marginTop: 28, marginBottom: 12 }}>SIMULERA EN DISK</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {Object.values(TAG_REGISTRY).map((b) => (
                  <Pressable key={b.id} onPress={() => simulate(b.id)} style={{ width: 100, paddingVertical: 12, paddingHorizontal: 8, borderRadius: RADIUS.md, borderWidth: 1, borderColor: T.hairline, backgroundColor: T.surface, alignItems: "center", gap: 6 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: b.soft, alignItems: "center", justifyContent: "center" }}>
                      <CafeIcon symbol={b.symbol} size={18} color={b.ink} strokeWidth={1.6} />
                    </View>
                    <Text style={{ fontFamily: FONT.uiMed, fontSize: 11, color: T.ink, textAlign: "center" }}>{b.name}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={onClose} style={{ alignSelf: "center", marginTop: 22 }}>
                <Text style={{ fontFamily: FONT.uiMed, fontSize: 14, color: T.inkMute }}>Avbryt</Text>
              </Pressable>
            </View>
          )}

          {phase === "result" && card && (
            <View>
              <View style={{ alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: card.soft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill, marginBottom: 14 }}>
                <Icon name="check" size={14} color={card.ink} strokeWidth={2.4} />
                <Text style={{ fontFamily: FONT.uiBold, fontSize: 11, color: card.ink, letterSpacing: 1 }}>{card.name.toUpperCase()}</Text>
              </View>
              <LoyaltyCard card={card} animateLast onOpenReward={() => {}} />
              <Text style={{ fontFamily: FONT.ui, fontSize: 13.5, color: T.inkMute, textAlign: "center", marginTop: 18 }}>
                +1 stämpel · tillagd automatiskt
              </Text>
              <Pressable onPress={onFinish} style={{ marginTop: 22, backgroundColor: T.ink, borderRadius: RADIUS.md, paddingVertical: 16, alignItems: "center" }}>
                <Text style={{ fontFamily: FONT.uiBold, color: "#fff", fontSize: 15 }}>Klar</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Scanner() {
  const wave = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
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
  }, []);
  return (
    <View style={{ height: 150, alignItems: "center", justifyContent: "center", marginTop: 8 }}>
      {wave.map((v, i) => (
        <Animated.View key={i} style={{ position: "absolute", width: 140, height: 140, borderRadius: 70, borderWidth: 1.5, borderColor: T.accent, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.5] }) }] }} />
      ))}
      <Animated.View style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: T.accent, alignItems: "center", justifyContent: "center", transform: [{ translateY: float }], shadowColor: T.accentDark, shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 }}>
        <Icon name="scan" size={36} color={T.accentInk} strokeWidth={2} />
      </Animated.View>
    </View>
  );
}

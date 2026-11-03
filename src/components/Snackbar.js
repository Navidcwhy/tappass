import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Animated } from "react-native";
import { T, FONT, tone as toneFor } from "../lib/theme";
import { Icon } from "../lib/icons";

// Meddelanden längst ner (se "Lägen och meddelanden" i designen):
//   info          — väntetid hos butiken (tonal ruta)
//   pending-block — belöning väntar → stämpling pausad (butikens färg + "Visa kod")
//   network       — ingen anslutning (mörk snackbar + "Försök igen")
//   unknown       — okänd stämpel (felruta)
export default function Snackbar({ toast, bottom = 100, onAction }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(toast);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (toast) {
      setShown(toast);
      Animated.spring(anim, { toValue: 1, friction: 8, tension: 70, useNativeDriver: true }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
        if (!toastRef.current) setShown(null);   // ett nytt meddelande hann komma — släck inte det
      });
    }
  }, [toast]);

  if (!shown) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={{ position: "absolute", left: 16, right: 16, bottom, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}
    >
      <Body toast={shown} onAction={onAction} />
    </Animated.View>
  );
}

const SHADOW = { shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 };

function Body({ toast, onAction }) {
  if (toast.type === "network") {
    return (
      <View style={{ ...SHADOW, borderRadius: 12, backgroundColor: T.inverseSurface, paddingVertical: 8, paddingLeft: 16, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Icon name="wifiOff" size={22} color={T.inverseOnSurface} />
        <Text style={{ flex: 1, fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: T.inverseOnSurface }}>Ingen anslutning just nu.</Text>
        {toast.canRetry && <ActionButton label="Försök igen" color={T.inversePrimary} onPress={() => onAction && onAction({ type: "retry" })} />}
      </View>
    );
  }

  if (toast.type === "pending-block") {
    const c = toast.card || {};
    const t = toneFor(c.ink);
    return (
      <View style={{ ...SHADOW, borderRadius: 16, backgroundColor: t.container, paddingVertical: 12, paddingLeft: 16, paddingRight: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Icon name="gift" size={22} color={t.onContainer} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONT.bold, fontSize: 14, lineHeight: 19, color: t.onContainer }}>Lös in belöningen först</Text>
          <Text style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: t.muted }}>Sedan kan du stämpla igen hos {c.name}.</Text>
        </View>
        {!!c.slug && (
          <Pressable
            onPress={() => onAction && onAction({ type: "open-reward", slug: c.slug })}
            accessibilityRole="button"
            style={({ pressed }) => ({ height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.88 : 1 })}
          >
            <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: "#FFFFFF" }}>Visa kod</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (toast.type === "unknown") {
    return (
      <View style={{ ...SHADOW, borderRadius: 16, backgroundColor: T.errorContainer, paddingVertical: 14, paddingHorizontal: 16, flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <Icon name="alert" size={22} color={T.onErrorContainer} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONT.bold, fontSize: 14, lineHeight: 19, color: T.onErrorContainer }}>Stämpeln känns inte igen</Text>
          <Text style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: T.errorText }}>Fråga personalen – den kan vara felkopplad.</Text>
        </View>
      </View>
    );
  }

  // info (väntetid)
  return (
    <View style={{ ...SHADOW, borderRadius: 16, backgroundColor: T.secondaryContainer, paddingVertical: 14, paddingHorizontal: 16, flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <Icon name="timer" size={22} color={T.onSecondaryContainer} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.bold, fontSize: 14, lineHeight: 19, color: T.onSecondaryContainer }}>{toast.title}</Text>
        {!!toast.subtitle && <Text style={{ fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: T.inkSoft }}>{toast.subtitle}</Text>}
      </View>
    </View>
  );
}

function ActionButton({ label, color, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ height: 40, paddingHorizontal: 12, borderRadius: 20, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ fontFamily: FONT.bold, fontSize: 14, color }}>{label}</Text>
    </Pressable>
  );
}

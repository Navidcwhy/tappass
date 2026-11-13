import React from "react";
import { View, Text, Pressable, Dimensions } from "react-native";
import { T, FONT, tone as toneFor } from "../lib/theme";
import { Icon } from "../lib/icons";
import { expiryText, isActiveUntil } from "../lib/wheel";
import Shape from "./Shape";
import StampRow from "./StampRow";
import Shine from "./Shine";

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "");

// Stämplarna krymper för butiker med många stämplar så att raden ryms på en rad
// (kortets innerbredd = skärmen − 16·2 marginal − 20·2 padding, 8 px mellanrum).
const stampSize = (n) => Math.max(18, Math.min(28, Math.floor((Dimensions.get("window").width - 72 + 8) / Math.max(1, n)) - 8));

// Ett stämpelkort i butikens egen tonpalett.
//   pågående     — "2 kvar till …" + stämplar
//   fullt        — BELÖNING KLAR + "Visa kod" (belöningen är inte sparad än)
//   sparad       — SPARAD BELÖNING + "Visa kod" (stämpling pausad tills inlöst)
// Kort med belöning får en holografisk glans; shineOffset (Animated-nod) låter
// glansen följa skrollningen och stillShine stänger av loopen (Reducera rörelse).
export default function LoyaltyCard({ card, onOpenReward, shineOffset, stillShine = false }) {
  const c = card;
  const t = toneFor(c.ink);
  const needed = Math.max(1, c.needed || 1);
  const stamps = Math.max(0, Math.min(c.stamps || 0, needed));
  const pending = !!c.pendingReward;
  const complete = !pending && stamps >= needed;
  const reward = pending || complete;
  const left = needed - stamps;
  const initial = (c.name || "?").trim().charAt(0).toUpperCase();
  const meta = [c.type, c.area].filter(Boolean).join(" · ");

  return (
    <View style={{ borderRadius: 28, backgroundColor: t.container, padding: 20, overflow: "hidden" }}>
      {reward && <Shape kind="sunny8" size={180} color={t.deco} style={{ position: "absolute", right: -46, top: -56 }} />}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Shape kind="cookie9" size={44} color={t.primary}>
          <Text style={{ fontFamily: FONT.bold, fontSize: 18, color: "#FFFFFF" }}>{initial}</Text>
        </Shape>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: FONT.title, fontSize: 20, lineHeight: 25, color: t.onContainer }}>{c.name}</Text>
          {!!meta && <Text numberOfLines={1} style={{ fontFamily: FONT.regular, fontSize: 14, lineHeight: 19, color: t.muted }}>{meta}</Text>}
        </View>
        {!reward && <Text style={{ fontFamily: FONT.bold, fontSize: 16, color: t.primary }}>{stamps}/{needed}</Text>}
      </View>

      {!pending && isActiveUntil(c.bonusExpiresAt) && <BonusBanner expiresAt={c.bonusExpiresAt} />}

      {reward ? (
        <View>
          <Text style={{ fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.96, color: t.primary, marginTop: 18 }}>
            {pending ? "SPARAD BELÖNING" : "BELÖNING KLAR"}
          </Text>
          <Text style={{ fontFamily: FONT.title, fontSize: 26, lineHeight: 30, color: t.onContainer, marginTop: 4 }}>{c.reward}</Text>
          {pending ? (
            <Text style={{ fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: t.muted, marginTop: 6 }}>
              Nya stämplar hos {c.name} pausas tills du löst in den.
            </Text>
          ) : (
            <View style={{ marginTop: 14 }}>
              <StampRow total={needed} filled={stamps} tone={t} size={stampSize(needed)} />
            </View>
          )}
          <Pressable
            onPress={() => onOpenReward(c.id)}
            accessibilityRole="button"
            style={({ pressed }) => ({ marginTop: 18, height: 56, borderRadius: 28, backgroundColor: t.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: pressed ? 0.88 : 1 })}
          >
            <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: "#FFFFFF" }}>Visa kod</Text>
            <Icon name="arrow" size={20} color="#FFFFFF" strokeWidth={2.2} />
          </Pressable>
        </View>
      ) : (
        <View>
          {left === 1 ? (
            <View style={{ marginTop: 14 }}>
              <Text style={{ fontFamily: FONT.title, fontSize: 22, lineHeight: 26, color: t.onContainer }}>Nästa är gratis!</Text>
              <Text style={{ fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, color: t.muted, marginTop: 2 }}>
                En stämpel kvar till {lowerFirst(c.rewardShort || c.reward)}
              </Text>
            </View>
          ) : (
            <Text style={{ fontFamily: FONT.title, fontSize: 22, lineHeight: 26, color: t.onContainer, marginTop: 14 }}>
              {left} kvar till {lowerFirst(c.rewardShort || c.reward)}
            </Text>
          )}
          <View style={{ marginTop: 12 }}>
            {/* Sista rutan lyser när bara en stämpel är kvar */}
            <StampRow total={needed} filled={stamps} tone={t} size={stampSize(needed)} glowIndex={left === 1 ? stamps : -1} />
          </View>
        </View>
      )}

      {reward && <Shine offset={shineOffset} still={stillShine} />}
    </View>
  );
}

// Dagens hjul: aktiv dubbelstämpel hos butiken.
function BonusBanner({ expiresAt }) {
  return (
    <View accessibilityLabel={"Dubbelstämpel aktiv. Nästa stämpel här ger 2, " + expiryText(expiresAt)} style={{ marginTop: 16, paddingVertical: 10, paddingLeft: 10, paddingRight: 14, borderRadius: 16, backgroundColor: T.lime, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Shape kind="burst12" size={40} color={T.primary}>
        <Text style={{ fontFamily: FONT.display, fontSize: 14, color: "#FFFFFF" }}>×2</Text>
      </Shape>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.bold, fontSize: 15, lineHeight: 20, color: T.onPrimaryContainer }}>Dubbelstämpel aktiv</Text>
        <Text style={{ fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, color: "#2E3A10" }}>Nästa stämpel här ger 2 · {expiryText(expiresAt, Date.now(), { short: true })}</Text>
      </View>
    </View>
  );
}

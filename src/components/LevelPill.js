import React from "react";
import { View, Text } from "react-native";
import { FONT } from "../lib/theme";
import { Icon } from "../lib/icons";
import { guestName } from "../lib/levels";

// Stamgästnivån hos ett ställe (v11): Brons, Silver eller Guld i metallton.
//   level — en nivå ur LEVELS (levels.js)
//   place — ställets namn, för skärmläsaren ("Silvergäst hos Miyabi")
export default function LevelPill({ level, place, large = false }) {
  if (!level) return null;
  const h = large ? 30 : 22;
  return (
    <View
      accessible
      accessibilityLabel={guestName(level) + (place ? " hos " + place : "")}
      style={{ height: h, paddingLeft: large ? 8 : 6, paddingRight: large ? 12 : 8, borderRadius: h / 2, backgroundColor: level.bg, flexDirection: "row", alignItems: "center", gap: large ? 6 : 4, alignSelf: "flex-start" }}
    >
      <View style={{ width: large ? 20 : 14, height: large ? 20 : 14, borderRadius: 10, backgroundColor: level.accent, alignItems: "center", justifyContent: "center" }}>
        <Icon name="award" size={large ? 13 : 10} color="#FFFFFF" strokeWidth={2.6} />
      </View>
      <Text style={{ fontFamily: FONT.bold, fontSize: large ? 14 : 12, color: level.ink }}>{level.name}</Text>
    </View>
  );
}

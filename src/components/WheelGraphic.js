import React from "react";
import { View, Animated } from "react-native";
import Svg, { Path, Circle, Text as SvgText } from "react-native-svg";
import { T, FONT } from "../lib/theme";
import { SEGMENTS, SEGMENT_DEG, isWinSegment, segmentCenter } from "../lib/wheel";
import BrandMark from "./BrandMark";

// Förlustfält i två toner så att grannar skiljer sig (fält 1/2 och 6/7 ligger bredvid varandra).
const LOSE_COLOR = { 1: T.secondaryContainer, 2: T.container, 4: T.secondaryContainer, 6: T.container, 7: T.secondaryContainer, 9: T.container };

function pt(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [150 + r * Math.sin(a), 150 - r * Math.cos(a)];
}

const WEDGES = Array.from({ length: SEGMENTS }).map((_, i) => {
  const [x0, y0] = pt(150, i * SEGMENT_DEG);
  const [x1, y1] = pt(150, (i + 1) * SEGMENT_DEG);
  return {
    d: `M150 150 L${x0.toFixed(2)} ${y0.toFixed(2)} A150 150 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`,
    fill: isWinSegment(i) ? T.primary : LOSE_COLOR[i],
  };
});

const MARKS = Array.from({ length: SEGMENTS }).map((_, i) => {
  const mid = segmentCenter(i);
  const [x, y] = pt(100, mid);
  return { i, mid, x, y, win: isWinSegment(i) };
});

// Själva hjulet. rotation = Animated.Value i grader (pekaren står still överst).
export default function WheelGraphic({ size = 300, rotation }) {
  const rim = Math.round(size * 0.026);
  const inner = size - rim * 2;
  const hub = Math.round(size * 0.24);
  const spin = rotation.interpolate({ inputRange: [0, 360], outputRange: ["0deg", "360deg"] });

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Hjul med tio fält. Fyra av dem ger dubbelstämpel."
      style={{ width: size, height: size }}
    >
      <View style={{ position: "absolute", left: 0, top: 0, width: size, height: size, borderRadius: size / 2, backgroundColor: T.surface, shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 6 }} />
      <Animated.View style={{ position: "absolute", left: rim, top: rim, width: inner, height: inner, transform: [{ rotate: spin }] }}>
        <Svg width={inner} height={inner} viewBox="0 0 300 300">
          {WEDGES.map((w, i) => (
            <Path key={"w" + i} d={w.d} fill={w.fill} stroke={T.surface} strokeWidth={3} strokeLinejoin="round" />
          ))}
          {MARKS.map((m) => m.win ? (
            <SvgText
              key={"m" + m.i}
              x={m.x}
              y={m.y + 9}
              fill="#FFFFFF"
              fontSize={27}
              fontFamily={FONT.display}
              textAnchor="middle"
              transform={`rotate(${m.mid}, ${m.x}, ${m.y})`}
            >
              ×2
            </SvgText>
          ) : (
            <Circle key={"m" + m.i} cx={m.x} cy={m.y} r={6.5} fill="none" stroke={T.inkMute} strokeWidth={2.5} />
          ))}
        </Svg>
      </Animated.View>

      {/* Navet står still: TapPass-symbolen på mörk botten */}
      <View style={{ position: "absolute", left: (size - hub) / 2, top: (size - hub) / 2, width: hub, height: hub, borderRadius: hub / 2, backgroundColor: T.ink, borderWidth: Math.max(3, Math.round(size * 0.016)), borderColor: T.surface, alignItems: "center", justifyContent: "center" }}>
        <BrandMark size={Math.round(hub * 0.5)} arcColor={T.bg} dotColor={T.lime} />
      </View>

      {/* Pekaren */}
      <View pointerEvents="none" style={{ position: "absolute", top: -14, left: size / 2 - 20, width: 40, height: 48 }}>
        <Svg width={40} height={48} viewBox="0 0 40 48">
          <Path d="M20 46 C14 34 3 26 3 17 A17 17 0 0 1 37 17 C37 26 26 34 20 46 Z" fill={T.ink} />
          <Circle cx={20} cy={17} r={6.5} fill={T.lime} />
        </Svg>
      </View>
    </View>
  );
}

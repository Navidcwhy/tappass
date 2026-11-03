import React from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { SHAPES } from "../lib/shapes";

// En mjuk form (cookie9, cookie12, sunny8, burst12, flower8, clover4) i en färg,
// med valfritt innehåll centrerat ovanpå. rotate i grader vrider bara formen.
export default function Shape({ kind = "cookie9", size = 28, color, rotate = 0, style, children }) {
  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      <View
        pointerEvents="none"
        style={{ position: "absolute", top: 0, left: 0, width: size, height: size, transform: rotate ? [{ rotate: rotate + "deg" }] : [] }}
      >
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path d={SHAPES[kind] || SHAPES.cookie9} fill={color} />
        </Svg>
      </View>
      {/* Egen vy så att innehållet (även SVG-ikoner) alltid ligger ovanpå formen */}
      {children != null && <View style={{ alignItems: "center", justifyContent: "center" }}>{children}</View>}
    </View>
  );
}

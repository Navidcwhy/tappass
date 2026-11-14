import React from "react";
import { View, Text } from "react-native";
import Svg, { Defs, ClipPath, Path, Image as SvgImage } from "react-native-svg";
import { FONT } from "../lib/theme";
import { SHAPES } from "../lib/shapes";
import { useLogo } from "../lib/logos";
import Shape from "./Shape";

let seq = 0;

// Butikens avatar: loggan (v13) urklippt i designens "cookie"-form, annars initialen
// i butikens färg som förut.
//   cafe  — normaliserat kort/ställe (slug, name, logoVersion)
//   color — formens färg när loggan saknas (tone(ink).primary)
export default function CafeAvatar({ cafe, size = 44, color, fontSize }) {
  const uri = useLogo(cafe && cafe.slug, cafe && cafe.logoVersion);
  const initial = ((cafe && cafe.name) || "?").trim().charAt(0).toUpperCase();
  const [id] = React.useState(() => "logo" + ++seq);
  if (uri) {
    return (
      <View accessibilityLabel={(cafe.name || "") + " logga"} style={{ width: size, height: size }}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <ClipPath id={id}>
              <Path d={SHAPES.cookie9} />
            </ClipPath>
          </Defs>
          <Path d={SHAPES.cookie9} fill="#FFFFFF" />
          <SvgImage href={{ uri }} x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid slice" clipPath={"url(#" + id + ")"} />
        </Svg>
      </View>
    );
  }
  return (
    <Shape kind="cookie9" size={size} color={color}>
      <Text style={{ fontFamily: FONT.bold, fontSize: fontSize || Math.round(size * 0.41), color: "#FFFFFF" }}>{initial}</Text>
    </Shape>
  );
}

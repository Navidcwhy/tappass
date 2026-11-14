// Designtokens — "K · Expressiv": Material 3-inspirerat med tonala ytor och mjuka
// former (se components/Shape.js). Varje butik får en egen tonpalett som räknas
// fram ur butikens färg (cafes.ink_color) — se tone() längst ner.
export const T = {
  // Ytor
  bg:        "#F8F7F3",   // appens yta (surface)
  surface:   "#FFFFFF",
  container: "#ECEBE4",   // navigering, sökfält, infokort (surfaceContainer)
  ink:       "#1B1C17",   // text (onSurface)
  inkSoft:   "#45483D",   // sekundär text (onSurfaceVariant)
  inkMute:   "#76786B",   // tredje nivå, platshållare
  outline:   "#C6C8B9",   // kantlinjer, chips, streckade kort
  hairline:  "#E4E2DA",

  // TapPass egna färger (från tappass.se:s lime)
  primary:              "#4A6800",
  onPrimary:            "#FFFFFF",
  primaryContainer:     "#DCE8B4",
  onPrimaryContainer:   "#1A2105",
  secondaryContainer:   "#E1E8C8",
  onSecondaryContainer: "#1A2105",
  tertiaryContainer:    "#FFDCC2",
  onTertiaryContainer:  "#5C2E0F",
  lime:                 "#C9EE6B",

  // Snackbar (mörk) och fel
  inverseSurface:   "#30312B",
  inverseOnSurface: "#F2F1E9",
  inversePrimary:   "#B6D97A",
  error:            "#BA1A1A",   // destruktiva knappar (Radera konto)
  errorContainer:   "#FFDAD6",
  onErrorContainer: "#410002",
  errorText:        "#5C1A14",

  scrim: "rgba(27,28,23,0.4)",
};

export const RADIUS = { sm: 8, md: 16, lg: 20, xl: 28, pill: 999 };

// Roboto Flex i sex statiska snitt (assets/fonts, SIL OFL). Varje snitt är en egen
// familj — använd aldrig fontWeight ihop med dem (Android väljer då systemfont).
export const FONT = {
  regular:  "RobotoFlex-Regular",    // 400 — brödtext
  medium:   "RobotoFlex-Medium",     // 500
  semibold: "RobotoFlex-SemiBold",   // 600 — knappar, chips
  bold:     "RobotoFlex-Bold",       // 700 — små etiketter, siffror
  title:    "RobotoFlex-Title",      // 650, optisk storlek 32 — rubriker 20–45 px
  display:  "RobotoFlex-Display",    // 750, bredd 110, optisk storlek 96 — koden, 8/8, +1
};

// Typsnitten ligger i appen — hämtas aldrig över nätet.
export const FONT_FILES = {
  "RobotoFlex-Regular":  require("../../assets/fonts/RobotoFlex-Regular.ttf"),
  "RobotoFlex-Medium":   require("../../assets/fonts/RobotoFlex-Medium.ttf"),
  "RobotoFlex-SemiBold": require("../../assets/fonts/RobotoFlex-SemiBold.ttf"),
  "RobotoFlex-Bold":     require("../../assets/fonts/RobotoFlex-Bold.ttf"),
  "RobotoFlex-Title":    require("../../assets/fonts/RobotoFlex-Title.ttf"),
  "RobotoFlex-Display":  require("../../assets/fonts/RobotoFlex-Display.ttf"),
};

/* ── Tonpalett per butik ──────────────────────────────────────────────
   Utgår från butikens färg och ger:
     primary     — knappar, fyllda stämplar (vit text ovanpå)
     container   — kortets bakgrund
     deco        — dekorformer och tomma stämplar
     light       — ljus gloria bakom stora former (på appens yta)
     onContainer — rubriker/kod ovanpå container
     muted       — sekundär text ovanpå container
   Gråa färger (låg mättnad) får ingen påhittad nyans. */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return "#" + hex(r) + hex(g) + hex(b);
}

const toneCache = {};
const FALLBACK_INK = "#5D6B36";

export function tone(ink) {
  const key = hexToRgb(ink) ? ink : FALLBACK_INK;
  if (toneCache[key]) return toneCache[key];
  const [h, s, l] = rgbToHsl(...hexToRgb(key));
  const sat = (lo, hi) => (s < 0.08 ? s : clamp(s, lo, hi));
  const t = {
    primary:     hslToHex(h, s, clamp(l, 0.18, 0.34)),
    container:   hslToHex(h, sat(0.30, 0.48), 0.85),
    deco:        hslToHex(h, sat(0.25, 0.42), 0.76),
    light:       hslToHex(h, sat(0.25, 0.40), 0.92),
    onContainer: hslToHex(h, sat(0.30, 0.60), 0.12),
    muted:       hslToHex(h, s < 0.08 ? s : 0.12, 0.30),
  };
  toneCache[key] = t;
  return t;
}

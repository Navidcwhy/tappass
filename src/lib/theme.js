// Design tokens — "Aesop meets Stripe": warm editorial
export const T = {
  // Surface
  bg:      "#F7F4EE",   // warm off-white canvas
  bgAlt:   "#EFEAE0",   // slightly deeper
  surface: "#FFFFFF",
  ink:     "#1A1612",   // near-black with warmth
  inkSoft: "#3E3631",
  inkMute: "#7C7269",
  inkFaint:"#B4ABA0",
  hairline:"#E6DFD2",

  // Accent — restrained, used as signature not as decoration
  accent:    "#B8D635",   // dampened lime (less neon)
  accentDark:"#8FAA1F",
  accentInk: "#1F2A07",

  // Status
  ok:   "#3FB950",
  warn: "#D97A4F",
  err:  "#C0392B",

  // Per-café palette — earthy jewel tones
  cafePalette: {
    linnea:   { ink: "#A04A22", soft: "#F3E5DA", deep: "#3C1A0C" },
    bryggan:  { ink: "#5D6B36", soft: "#EDEEDB", deep: "#262E18" },
    saluhall: { ink: "#1B5A66", soft: "#DEE9EA", deep: "#0C2A30" },
    tehuset:  { ink: "#6E2E3D", soft: "#F0E0E4", deep: "#2E121A" },
    glassbar: { ink: "#9A6A1F", soft: "#F3EBD7", deep: "#3D2B0B" },
  },
};

export const RADIUS = { sm: 8, md: 14, lg: 22, xl: 28, pill: 999 };

export const FONT = {
  display: "InstrumentSerif",       // for big headlines (italic-like serif)
  displayItalic: "InstrumentSerifItalic",
  ui: "InterTight",                  // for everything else
  uiMed: "InterTightMed",
  uiBold: "InterTightBold",
  mono: "JetBrainsMono",
};

// Fonts are bundled in the app (assets/fonts, SIL OFL licensed) — never fetched
// at runtime. The old fonts.gstatic.com URLs returned 404 for 5 of 6 files and
// put a network round-trip on the critical startup path.
export const FONT_FILES = {
  InstrumentSerif:       require("../../assets/fonts/InstrumentSerif_400Regular.ttf"),
  InstrumentSerifItalic: require("../../assets/fonts/InstrumentSerif_400Regular_Italic.ttf"),
  InterTight:            require("../../assets/fonts/InterTight_400Regular.ttf"),
  InterTightMed:         require("../../assets/fonts/InterTight_500Medium.ttf"),
  InterTightBold:        require("../../assets/fonts/InterTight_700Bold.ttf"),
  JetBrainsMono:         require("../../assets/fonts/JetBrainsMono_400Regular.ttf"),
};

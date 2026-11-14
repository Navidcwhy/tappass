jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(), impactAsync: jest.fn(), selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
jest.mock("react-native-svg", () => {
  const React = require("react");
  const C = (p) => React.createElement("SvgMock", p, p.children);
  return { __esModule: true, default: C, Svg: C, Path: C, Circle: C, Text: C, G: C, Defs: C, LinearGradient: C, RadialGradient: C, Stop: C, Rect: C };
});
jest.mock("lucide-react-native", () => new Proxy({}, { get: (_, k) => (k === "__esModule" ? false : () => null) }));
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
// NFC-modulen kräver den inbyggda modulen (finns inte i Jest, särskilt inte med iOS-förinställningen).
jest.mock("react-native-nfc-manager", () => ({
  __esModule: true,
  default: {
    start: jest.fn(() => Promise.resolve()), isSupported: jest.fn(() => Promise.resolve(true)), isEnabled: jest.fn(() => Promise.resolve(true)),
    requestTechnology: jest.fn(() => new Promise(() => {})), getTag: jest.fn(() => Promise.resolve(null)),
    cancelTechnologyRequest: jest.fn(() => Promise.resolve()), setAlertMessageIOS: jest.fn(() => Promise.resolve()),
  },
  NfcTech: { Ndef: "Ndef" },
  Ndef: { TNF_WELL_KNOWN: 1, RTD_TEXT: "T", RTD_URI: "U", isType: () => false, text: { decodePayload: () => "" }, uri: { decodePayload: () => "" } },
}));

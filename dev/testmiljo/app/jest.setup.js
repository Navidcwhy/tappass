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

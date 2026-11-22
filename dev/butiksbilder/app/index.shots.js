// Ingång för butiksbilderna: väljer plattform (?os=ios|android) innan appens moduler laddas.
import { registerRootComponent } from "expo";
const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
global.__SHOT_OS__ = params.get("os") === "android" ? "android" : "ios";
window.__SHOT_INSETS__ = { top: Number(params.get("top") || 0), bottom: Number(params.get("bottom") || 0), left: 0, right: 0 };
const App = require("../App").default;
registerRootComponent(App);

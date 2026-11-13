// tokenFromUrl med riktiga expo-linking (inte mockad): alla tre länkformer.
jest.mock("react-native-url-polyfill/auto", () => ({}));
jest.mock("expo-font", () => ({ loadAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(() => Promise.resolve()), hideAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("../src/lib/nfc", () => ({ initNfc: jest.fn(), readToken: jest.fn(), cancelNfc: jest.fn(), setIosAlert: jest.fn(), isCancelOrTimeout: jest.fn() }));
jest.mock("../src/lib/useNfcStatus", () => ({ useNfcStatus: () => ({ supported: true, enabled: true }) }));
jest.mock("../src/lib/cache", () => ({ readCache: jest.fn(), writeCache: jest.fn() }));
jest.mock("../src/lib/prefs", () => ({ hasOnboarded: jest.fn(), markOnboarded: jest.fn(), getWheelCity: jest.fn(), setWheelCity: jest.fn(), hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn() }));
jest.mock("../src/lib/supabase", () => ({}));

const { tokenFromUrl } = require("../App");

test.each([
  ["https://tappass.se/t/miyabi-01", "miyabi-01"],
  ["https://tappass.se/t/Miyabi-01/", "miyabi-01"],
  ["tappass://t/miyabi-01", "miyabi-01"],          // länken "Jag har redan appen" på iPhone
  ["tappass:///t/bryggan-01", "bryggan-01"],
  ["https://tappass.se/terms", null],
  ["https://t.example.com/miyabi-01", null],       // https med värdnamn "t…" är inte vår länk
  ["", null],
])("%s → %s", (url, want) => {
  expect(tokenFromUrl(url)).toBe(want);
});

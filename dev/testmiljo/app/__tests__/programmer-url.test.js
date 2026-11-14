// isProgrammerUrl med riktiga expo-linking (inte mockad), som tokenFromUrl i fixes-deeplink.
jest.mock("react-native-url-polyfill/auto", () => ({}));
jest.mock("expo-font", () => ({ loadAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(() => Promise.resolve()), hideAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("../src/lib/nfc", () => ({ initNfc: jest.fn(), readToken: jest.fn(), cancelNfc: jest.fn(), setIosAlert: jest.fn(), isCancelOrTimeout: jest.fn(), openIsoDep: jest.fn() }));
jest.mock("../src/lib/useNfcStatus", () => ({ useNfcStatus: () => ({ supported: true, enabled: true }) }));
jest.mock("../src/lib/cache", () => ({ readCache: jest.fn(), writeCache: jest.fn() }));
jest.mock("../src/lib/prefs", () => ({ hasOnboarded: jest.fn(), markOnboarded: jest.fn(), getWheelCity: jest.fn(), setWheelCity: jest.fn(), hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn() }));
jest.mock("../src/lib/supabase", () => ({}));

const { isProgrammerUrl, tokenFromUrl } = require("../App");

test.each([
  ["tappass://programmera", true],
  ["tappass:///programmera", true],
  ["tappass://programmera/", true],
  ["TAPPASS://Programmera", true],
  ["https://tappass.se/programmera", false],
  ["https://programmera.se/", false],
  ["tappass://t/programmera", false],
  ["tappass://t/miyabi-01", false],
  ["tappass://programmera-01", false],
  ["", false],
  [null, false],
])("%s → %s", (url, want) => {
  expect(isProgrammerUrl(url)).toBe(want);
});

test("programmeringslänken är ingen stämpel", () => {
  expect(tokenFromUrl("tappass://programmera")).toBeNull();
  expect(tokenFromUrl("tappass:///programmera")).toBeNull();
});

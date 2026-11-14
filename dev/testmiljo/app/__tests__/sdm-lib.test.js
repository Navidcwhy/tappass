// Dynamiska taggar (v17): tolkningen av taggens innehåll och länkar — rena funktioner,
// och tagFromUrl med riktiga expo-linking.
jest.mock("react-native-url-polyfill/auto", () => ({}));
jest.mock("expo-font", () => ({ loadAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(() => Promise.resolve()), hideAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("../src/lib/nfc", () => ({ initNfc: jest.fn(), readToken: jest.fn(), cancelNfc: jest.fn(), setIosAlert: jest.fn(), isCancelOrTimeout: jest.fn() }));
jest.mock("../src/lib/useNfcStatus", () => ({ useNfcStatus: () => ({ supported: true, enabled: true }) }));
jest.mock("../src/lib/cache", () => ({ readCache: jest.fn(), writeCache: jest.fn() }));
jest.mock("../src/lib/prefs", () => ({ hasOnboarded: jest.fn(), markOnboarded: jest.fn(), getWheelCity: jest.fn(), setWheelCity: jest.fn(), hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn() }));
jest.mock("../src/lib/supabase", () => ({}));

const { splitTag, sunFromQuery, wireToken } = require("../src/lib/tagurl");
const { tagFromUrl, tokenFromUrl } = require("../App");

const E = "ef963ff7828658a599f3041510671e88";
const C = "94eed9ee65337086";

test("sunFromQuery: e och c, i valfri ordning, p= som e=, annars null", () => {
  expect(sunFromQuery("e=" + E + "&c=" + C)).toEqual({ e: E, c: C });
  expect(sunFromQuery("?c=" + C.toUpperCase() + "&E=" + E.toUpperCase())).toEqual({ e: E, c: C });
  expect(sunFromQuery("p=" + E + "&c=" + C + "&x=1")).toEqual({ e: E, c: C });
  expect(sunFromQuery("e=" + E)).toBeNull();                       // c saknas
  expect(sunFromQuery("e=" + E.slice(1) + "&c=" + C)).toBeNull();  // 31 tecken
  expect(sunFromQuery("e=" + E + "&c=" + C + "0")).toBeNull();     // 17 tecken
  expect(sunFromQuery("e=" + E.replace("e", "g") + "&c=" + C)).toBeNull();
  expect(sunFromQuery("")).toBeNull();
  expect(sunFromQuery(null)).toBeNull();
});

test("splitTag: textrecord, adress och SUN", () => {
  expect(splitTag("miyabi-01")).toEqual({ token: "miyabi-01", sun: null });
  expect(splitTag(" MIYABI-01 ")).toEqual({ token: "miyabi-01", sun: null });
  expect(splitTag("miyabi")).toEqual({ token: "miyabi-01", sun: null });   // slug → databasens form
  expect(splitTag("https://tappass.se/t/miyabi-01")).toEqual({ token: "miyabi-01", sun: null });
  expect(splitTag("https://tappass.se/t/miyabi-01/")).toEqual({ token: "miyabi-01", sun: null });
  expect(splitTag("https://tappass.se/t/miyabi-01?e=" + E.toUpperCase() + "&c=" + C.toUpperCase())).toEqual({ token: "miyabi-01", sun: { e: E, c: C } });
  expect(splitTag("https://tappass.se/t/miyabi-01/?e=" + E + "&c=" + C + "#x")).toEqual({ token: "miyabi-01", sun: { e: E, c: C } });
  expect(splitTag("miyabi-01?e=" + E + "&c=" + C)).toEqual({ token: "miyabi-01", sun: { e: E, c: C } });   // som äldre byggen läste
  expect(splitTag("miyabi-01?e=00")).toEqual({ token: "miyabi-01", sun: null });
  expect(splitTag("hej")).toEqual({ token: "hej-01", sun: null });   // okänt → servern svarar unknown_tag
  expect(splitTag("")).toBeNull();
  expect(splitTag("   ")).toBeNull();
  expect(splitTag(null)).toBeNull();
  expect(splitTag("?e=" + E + "&c=" + C)).toBeNull();
});

test("wireToken: det som skickas till tap_token", () => {
  expect(wireToken("miyabi-01", null)).toBe("miyabi-01");
  expect(wireToken("miyabi-01", undefined)).toBe("miyabi-01");
  expect(wireToken("miyabi-01", { e: E, c: C })).toBe("miyabi-01?e=" + E + "&c=" + C);
  expect(wireToken("miyabi-01", { e: E })).toBe("miyabi-01");
  expect(wireToken("miyabi-01", { e: "x", c: C })).toBe("miyabi-01");
});

test.each([
  ["https://tappass.se/t/miyabi-01?e=" + E + "&c=" + C, { token: "miyabi-01", sun: { e: E, c: C } }],
  ["https://tappass.se/t/Miyabi-01?E=" + E.toUpperCase() + "&C=" + C.toUpperCase(), { token: "miyabi-01", sun: { e: E, c: C } }],
  ["tappass://t/miyabi-01?e=" + E + "&c=" + C, { token: "miyabi-01", sun: { e: E, c: C } }],   // "Jag har redan appen" som skickar med e/c
  ["tappass:///t/bryggan-01?c=" + C + "&e=" + E, { token: "bryggan-01", sun: { e: E, c: C } }],
  ["https://tappass.se/t/miyabi-01", { token: "miyabi-01", sun: null }],
  ["https://tappass.se/t/miyabi-01?e=" + E, { token: "miyabi-01", sun: null }],
  ["https://tappass.se/terms?e=" + E + "&c=" + C, null],
])("tagFromUrl %s", (url, want) => {
  expect(tagFromUrl(url)).toEqual(want);
});

test("tokenFromUrl ger bara token", () => {
  expect(tokenFromUrl("https://tappass.se/t/miyabi-01?e=" + E + "&c=" + C)).toBe("miyabi-01");
  expect(tokenFromUrl("")).toBeNull();
});

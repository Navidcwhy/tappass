// Taggverktyget i appen (v17): inklistring, programmering mot en simulerad NTAG 424 DNA via
// en mockad IsoDep-session, fel och återupptagning, avbryt, återställ, iPhone-läget — och
// i App: tappass://programmera, inga stämplar medan verktyget är öppet, dold väg i hjälpen.
import React from "react";
import { act } from "react-test-renderer";
import { mount, unmountAll, text, until, flush, press } from "./helpers";

jest.setTimeout(90000);
jest.mock("react-native-url-polyfill/auto", () => ({}));
jest.mock("expo-font", () => ({ loadAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(() => Promise.resolve()), hideAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-linking", () => ({
  getInitialURL: jest.fn(() => Promise.resolve(null)),
  addEventListener: jest.fn(() => ({ remove() {} })),
  parse: jest.fn((url) => {
    const m = String(url).match(/^([\w+]+):\/\/([^/?#]*)\/?([^?#]*)/);
    return m ? { scheme: m[1], hostname: m[2] || null, path: m[3] || null } : { path: "" };
  }),
}));
const mockReads = { waiting: [] };
const mockIso = { next: null };
jest.mock("../src/lib/nfc", () => ({
  IS_IOS: require("react-native").Platform.OS === "ios",
  initNfc: jest.fn(() => Promise.resolve()),
  readToken: jest.fn(() => new Promise((resolve) => { mockReads.waiting.push(resolve); })),
  cancelNfc: jest.fn(() => Promise.resolve()),
  setIosAlert: jest.fn(() => Promise.resolve()), isCancelOrTimeout: jest.fn(() => true),
  openIsoDep: jest.fn(() => new Promise((resolve, reject) => { mockIso.next = { resolve, reject }; })),
}));
const mockNfc = { supported: true, enabled: true };
jest.mock("../src/lib/useNfcStatus", () => ({ useNfcStatus: () => mockNfc }));
jest.mock("../src/lib/cache", () => ({ readCache: jest.fn(() => Promise.resolve(null)), writeCache: jest.fn() }));
jest.mock("../src/lib/prefs", () => ({
  inviteHintDismissed: jest.fn(() => Promise.resolve(true)), dismissInviteHint: jest.fn(),
  getAccount: jest.fn(() => Promise.resolve(null)), setAccount: jest.fn(), clearAccount: jest.fn(),
  accountHintDismissed: jest.fn(() => Promise.resolve(true)), dismissAccountHint: jest.fn(),
  hasOnboarded: jest.fn(() => Promise.resolve(true)), markOnboarded: jest.fn(),
  getWheelCity: jest.fn(() => Promise.resolve("Stockholm")), setWheelCity: jest.fn(),
  hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn(),
}));
jest.mock("../src/lib/supabase", () => ({
  inviteStatus: jest.fn(() => Promise.resolve({ ok: true, unavailable: true })), ackInvites: jest.fn(), getInviteCode: jest.fn(), redeemInvite: jest.fn(),
  birthdayStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false, birthday: null, window: null, gifts: [] })),
  getAuthMethods: jest.fn(() => Promise.resolve({ email: false, apple: false, google: false })),
  accountStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false })), newDeviceId: jest.fn(() => Promise.resolve("d_ny")),
  tapToken: jest.fn(), saveReward: jest.fn(), loadWallet: jest.fn(), loadCafes: jest.fn(),
  wheelStatus: jest.fn(), spinWheel: jest.fn(), claimWheelPrize: jest.fn(), getCurrentSavedCode: jest.fn(),
  redeemByTap: jest.fn(), cancelSavedReward: jest.fn(), getCafeLogo: jest.fn(),
}));

const crypto = require("crypto");
const { Platform } = require("react-native");
const nfcLib = require("../src/lib/nfc");
const sb = require("../src/lib/supabase");
const Linking = require("expo-linking");
const { SimTag, connect } = require("./sim-ntag424");
const TagProgrammer = require("../src/components/TagProgrammer").default;
const IOS = Platform.OS === "ios";
const androidOnly = IOS ? test.skip : test;
const iosOnly = IOS ? test : test.skip;

// Resultatet från admin_sdm_issue_keys (rutnät) med slumpade testnycklar
function pasted(token = "miyabi-01") {
  const keys = [0, 1, 2].map(() => crypto.randomBytes(16).toString("hex"));
  const uri = "tappass.se/t/" + token + "?e=" + "0".repeat(32) + "&c=" + "0".repeat(16);
  const rows = [[1, "Tagg", token], [2, "Adress (URI-record, prefix https://)", "https://" + uri],
    [3, "Nyckel 0 – huvudnyckel (AppMasterKey)", keys[0]], [4, "Nyckel 1 – SDMMetaRead (krypterar e)", keys[1]], [5, "Nyckel 2 – SDMFileRead (räknar c)", keys[2]],
    [11, "NDEF-filens åtkomst", "läsa fritt (E) · skriva och ändra inställningar med nyckel 0"]];
  return { keys, text: "steg\tinstallning\tvarde\n" + rows.map((r) => r.join("\t")).join("\n") };
}
const input = (tree) => tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Resultatet från admin_sdm_issue_keys" && typeof n.props.onChangeText === "function")[0];
const paste = async (tree, s) => { await act(async () => { input(tree).props.onChangeText(s); }); };
const tagReady = async (tag, opts) => { await until(() => mockIso.next, "IsoDep väntar"); const n = mockIso.next; mockIso.next = null; await act(async () => { n.resolve(connect(tag, opts)); }); };

beforeEach(() => {
  jest.clearAllMocks();
  mockIso.next = null;
  mockReads.waiting.length = 0;
  mockNfc.supported = true; mockNfc.enabled = true;
});
afterEach(unmountAll);

androidOnly("klistra in → programmera → klart; nycklarna visas aldrig hela och rensas", async () => {
  const onClose = jest.fn();
  const tree = await mount(<TagProgrammer visible onClose={onClose} />);
  expect(text(tree)).toContain("Programmera stämpel");
  expect(text(tree)).toContain("Programmera taggen");
  await press(tree, "Programmera taggen");                  // inaktiv utan nycklar
  expect(nfcLib.openIsoDep).not.toHaveBeenCalled();

  await paste(tree, "skräp");
  expect(text(tree)).toContain("Hittar inte taggens namn");
  const p = pasted();
  await paste(tree, p.text);
  const t = text(tree);
  expect(t).toContain("miyabi-01");
  expect(t).toContain("Nyckel 0 ••••" + p.keys[0].slice(-4));
  expect(t).toContain("https://tappass.se/t/miyabi-01?e=");
  p.keys.forEach((k) => expect(t).not.toContain(k));
  expect(input(tree)).toBeUndefined();                     // inklistrad text (med nycklarna) visas inte längre
  const swap = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Byt nycklar" && typeof n.props.onPress === "function")[0];
  await act(async () => { swap.props.onPress(); });
  expect(input(tree).props.value).toBe("");
  await paste(tree, p.text);

  await press(tree, "Programmera taggen");
  await until(() => text(tree).includes("Håll taggen mot mitten av telefonens baksida."), "väntar på taggen");
  expect(nfcLib.cancelNfc).toHaveBeenCalled();             // ev. kvarvarande läsning först
  const tag = new SimTag();
  await tagReady(tag, { asArray: true });
  await until(() => text(tree).includes("Klart – stämpeln är dynamisk"), "klart");
  const done = text(tree);
  expect(done).toContain("UID " + tag.uid.toString("hex").toUpperCase().match(/../g).join(" "));
  expect(done).toContain("admin_sdm_enforce('miyabi-01')");
  expect(input(tree)).toBeUndefined();
  expect(tag.keys.slice(0, 3).map((k) => k.toString("hex"))).toEqual(p.keys);
  expect(nfcLib.cancelNfc.mock.calls.length).toBeGreaterThanOrEqual(2);

  await press(tree, "Programmera nästa tagg");
  expect(input(tree).props.value).toBe("");                // nycklarna följer inte med till nästa tagg
  const close = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Stäng" && typeof n.props.onPress === "function")[0];
  await act(async () => { close.props.onPress(); });
  expect(onClose).toHaveBeenCalled();
});

androidOnly("kontakten bryts → felruta → Försök igen fortsätter där den slutade", async () => {
  const tree = await mount(<TagProgrammer visible onClose={() => {}} />);
  const p = pasted();
  await paste(tree, p.text);
  const tag = new SimTag();
  await press(tree, "Programmera taggen");
  await tagReady(tag, { cut: { at: 12, after: true } });
  await until(() => text(tree).includes("Kontakten bröts"), "felruta");
  expect(text(tree)).toContain("Försök igen");
  expect(input(tree)).toBeUndefined();                     // nycklarna kvar för nästa försök (visas inte)
  expect(text(tree)).toContain("Nyckel 2 ••••" + p.keys[2].slice(-4));
  await press(tree, "Försök igen");
  await tagReady(tag);
  await until(() => text(tree).includes("Klart – stämpeln är dynamisk"), "klart efter nytt försök");
  expect([...tag.keyVer]).toEqual([1, 1, 1, 0, 0]);
});

androidOnly("redan programmerad med andra nycklar → tydligt fel; avbryt medan den väntar", async () => {
  const tree = await mount(<TagProgrammer visible onClose={() => {}} />);
  const tag = new SimTag();
  await paste(tree, pasted().text);
  await press(tree, "Programmera taggen");
  await tagReady(tag);
  await until(() => text(tree).includes("Klart"), "första");
  await press(tree, "Programmera nästa tagg");
  await paste(tree, pasted().text);                       // nya nycklar, samma tagg
  await press(tree, "Programmera taggen");
  await tagReady(tag);
  await until(() => text(tree).includes("redan programmerad med andra nycklar"), "fel nycklar");

  await press(tree, "Försök igen");
  await until(() => mockIso.next, "väntar");
  await press(tree, "Avbryt");
  expect(nfcLib.cancelNfc).toHaveBeenCalled();
  await act(async () => { mockIso.next.reject(new Error("cancelled")); });
  await flush();
  expect(text(tree)).toContain("Programmera taggen");
  expect(text(tree)).not.toContain("redan programmerad");   // det gamla felet försvann vid nytt försök
  expect(text(tree)).not.toContain("Håll taggen mot mitten");
});

androidOnly("återställ en programmerad tagg; NFC avstängt", async () => {
  const p = pasted();
  const tag = new SimTag();
  {
    const tree = await mount(<TagProgrammer visible onClose={() => {}} />);
    await paste(tree, p.text);
    await press(tree, "Programmera taggen");
    await tagReady(tag);
    await until(() => text(tree).includes("Klart"), "programmerad");
    await press(tree, "Programmera nästa tagg");
    await press(tree, "Återställ");
    expect(text(tree)).toContain("taggens nuvarande nycklar");
    await paste(tree, p.text);
    await press(tree, "Återställ taggen");
    await tagReady(tag);
    await until(() => text(tree).includes("Taggen är återställd"), "återställd");
    expect([...tag.keyVer]).toEqual([0, 0, 0, 0, 0]);
    await press(tree, "Programmera en tagg");
    expect(text(tree)).toContain("hela resultatet av admin_sdm_issue_keys");
  }
  mockNfc.enabled = false;
  nfcLib.openIsoDep.mockClear();
  const tree2 = await mount(<TagProgrammer visible onClose={() => {}} />);
  await paste(tree2, pasted().text);
  expect(text(tree2)).toContain("NFC är avstängt");
  await press(tree2, "Programmera taggen");
  expect(nfcLib.openIsoDep).not.toHaveBeenCalled();
});

iosOnly("iPhone: bara beskedet att det kräver Android", async () => {
  const tree = await mount(<TagProgrammer visible onClose={() => {}} />);
  expect(text(tree)).toContain("kräver en Android-telefon");
  expect(input(tree)).toBeUndefined();
});

// ---------- i App ----------
const { isProgrammerUrl } = require("../App");
test.each([
  ["tappass://programmera", true],
  ["tappass:///programmera", true],
  ["exp+tappass://programmera", true],
  ["https://tappass.se/programmera", false],
  ["tappass://t/miyabi-01", false],
  ["", false],
])("isProgrammerUrl(%s) = %s", (url, want) => { expect(isProgrammerUrl(url)).toBe(want); });

const MIYABI = { slug: "miyabi", name: "Miyabi", type: "Sushi", area: "Lidingö", ink_color: "#1B5A66", reward_text: "En 5-bitars sushi", reward_short: "Gratis sushi", stamps_needed: 6, city: "Stockholm" };
const OK = { ok: true, cafe: MIYABI, stamps: 3, complete: false, stamps_added: 1, bonus_applied: false, quiet_applied: false, carry_over: 0 };
const startApp = async () => {
  const App = require("../App").default;
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Miyabi"), "appen laddad");
  return tree;
};
const urlHandler = () => Linking.addEventListener.mock.calls[Linking.addEventListener.mock.calls.length - 1][1];

describe("App", () => {
  beforeEach(() => {
    sb.loadCafes.mockResolvedValue([MIYABI]);
    sb.loadWallet.mockResolvedValue([{ cafe: MIYABI, stamps: 2, pending: false }]);
    sb.wheelStatus.mockResolvedValue({ ok: true, can_spin: false, next_spin_at: new Date(Date.now() + 3600e3).toISOString(), cities: [] });
    sb.tapToken.mockResolvedValue(OK);
  });

  androidOnly("tappass://programmera öppnar verktyget; inga stämplar medan det är öppet", async () => {
    Linking.getInitialURL.mockResolvedValueOnce("tappass://programmera");
    const tree = await startApp();
    await until(() => text(tree).includes("Programmera stämpel"), "verktyget öppet");
    expect(text(tree)).not.toContain("Redo att stämpla");   // läsningen pausad
    await act(async () => { urlHandler()({ url: "https://tappass.se/t/miyabi-01?e=" + "a".repeat(32) + "&c=" + "b".repeat(16) }); });
    await flush();
    expect(sb.tapToken).not.toHaveBeenCalled();
    const closes = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Stäng" && n.props.accessibilityRole === "button" && typeof n.props.onPress === "function");
    expect(closes).toHaveLength(1);
    await act(async () => { closes[0].props.onPress(); });
    await until(() => text(tree).includes("Redo att stämpla"), "läsningen igång igen");
    await act(async () => { urlHandler()({ url: "https://tappass.se/t/miyabi-01" }); });
    await until(() => sb.tapToken.mock.calls.length === 1, "stämpel efter stängning");
  });

  androidOnly("dold väg: håll på bilden i hjälpen i tre sekunder", async () => {
    const tree = await startApp();
    const help = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Hjälp och introduktion" && typeof n.props.onPress === "function")[0];
    await act(async () => { help.props.onPress(); });
    await until(() => text(tree).includes("Stämpelkortet som bor i telefonen"), "hjälpen");
    const art = tree.root.findAll((n) => n.props && typeof n.props.onLongPress === "function" && n.props.delayLongPress === 3000)[0];
    expect(art.props.accessible).toBe(false);
    await act(async () => { art.props.onLongPress(); });
    await until(() => text(tree).includes("Programmera stämpel"), "verktyget via hjälpen");
    expect(text(tree)).not.toContain("Stämpelkortet som bor i telefonen");
  });

  iosOnly("iPhone: ingen dold väg i hjälpen", async () => {
    const tree = await startApp();
    const help = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Hjälp och introduktion" && typeof n.props.onPress === "function")[0];
    await act(async () => { help.props.onPress(); });
    await until(() => text(tree).includes("Stämpelkortet som bor i telefonen"), "hjälpen");
    expect(tree.root.findAll((n) => n.props && typeof n.props.onLongPress === "function" && n.props.delayLongPress === 3000)).toHaveLength(0);
  });
});

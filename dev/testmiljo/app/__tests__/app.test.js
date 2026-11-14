import React from "react";
import { act } from "react-test-renderer";
import { mount, unmountAll, text, press, until, tick, flush } from "./helpers";

jest.setTimeout(90000);
jest.mock("react-native-url-polyfill/auto", () => ({}));
jest.mock("expo-font", () => ({ loadAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(() => Promise.resolve()), hideAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-linking", () => ({ getInitialURL: jest.fn(() => Promise.resolve(null)), addEventListener: jest.fn(() => ({ remove() {} })), parse: jest.fn(() => ({ path: "" })) }));
jest.mock("../src/lib/nfc", () => ({
  initNfc: jest.fn(() => Promise.resolve()), readToken: jest.fn(() => new Promise(() => {})), cancelNfc: jest.fn(() => Promise.resolve()),
  setIosAlert: jest.fn(() => Promise.resolve()), isCancelOrTimeout: jest.fn(() => true),
}));
jest.mock("../src/lib/useNfcStatus", () => ({ useNfcStatus: () => ({ supported: true, enabled: true }) }));
jest.mock("../src/lib/cache", () => ({ readCache: jest.fn(() => Promise.resolve(null)), writeCache: jest.fn() }));
jest.mock("../src/lib/prefs", () => ({
  inviteHintDismissed: jest.fn(() => Promise.resolve(true)), dismissInviteHint: jest.fn(),
  getAccount: jest.fn(() => Promise.resolve(null)), setAccount: jest.fn(), clearAccount: jest.fn(),
  accountHintDismissed: jest.fn(() => Promise.resolve(false)), dismissAccountHint: jest.fn(),
  hasOnboarded: jest.fn(() => Promise.resolve(true)), markOnboarded: jest.fn(),
  getWheelCity: jest.fn(() => Promise.resolve("Stockholm")), setWheelCity: jest.fn(),
  hasFirstStamp: jest.fn(() => Promise.resolve(true)), markFirstStamp: jest.fn(),
}));
jest.mock("../src/lib/supabase", () => ({
  inviteStatus: jest.fn(() => Promise.resolve({ ok: true, unavailable: true })), ackInvites: jest.fn(() => Promise.resolve({ ok: true })),
  getInviteCode: jest.fn(), redeemInvite: jest.fn(),
  birthdayStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false, birthday: null, window: null, gifts: [] })),
  getAuthMethods: jest.fn(() => Promise.resolve({ email: false, apple: false, google: false })),
  accountStatus: jest.fn(() => Promise.resolve({ ok: true, linked: false })), newDeviceId: jest.fn(() => Promise.resolve("d_ny")),
  tapToken: jest.fn(), saveReward: jest.fn(), loadWallet: jest.fn(), loadCafes: jest.fn(),
  wheelStatus: jest.fn(), spinWheel: jest.fn(), claimWheelPrize: jest.fn(), getCurrentSavedCode: jest.fn(),
}));

const sb = require("../src/lib/supabase");
const App = require("../App").default;

const MIYABI = { slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", symbol: "", ink_color: "#1B5A66", soft_color: "", deep_color: "", reward_text: "En 5-bitars sushi på huset", reward_short: "Gratis 5-bitars sushi", stamps_needed: 6, city: "Stockholm" };
const BRYGGAN = { ...MIYABI, slug: "bryggan", name: "Bryggans Bageri", type: "Bageri", area: "Södermalm", ink_color: "#56642B", reward_text: "En kanelbulle", reward_short: "Kanelbulle", stamps_needed: 8 };
const future = (h) => new Date(Date.now() + h * 3600000).toISOString();
const STATUS = (over = {}) => ({ ok: true, can_spin: true, next_spin_at: future(13), today: null, prize: null, bonuses: [], cities: [{ city: "Stockholm", places: 2 }], ...over });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  sb.loadCafes.mockResolvedValue([MIYABI, BRYGGAN]);
  sb.loadWallet.mockResolvedValue([{ cafe: MIYABI, stamps: 3, pending: false, bonus_expires_at: future(50) }]);
  sb.wheelStatus.mockResolvedValue(STATUS());
});
afterEach(async () => { await unmountAll(); jest.clearAllTimers(); jest.useRealTimers(); });

async function start() {
  const tree = await mount(<App />);
  await until(() => text(tree).includes("Dina kort"), "start");
  await until(() => text(tree).includes("Miyabi"), "plånboken");
  return tree;
}

test("bonusen syns på kortet och hjulfliken har en prick när ett snurr väntar", async () => {
  const tree = await start();
  expect(text(tree)).toContain("Dubbelstämpel aktiv");
  const tabs = tree.root.findAll((n) => n.props && n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function");
  expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(["Kort", "Hjul, nytt snurr väntar", "Ställen"]);
});

test("dubbelstämpel: +2 i arket och hjulets läge hämtas om", async () => {
  sb.tapToken.mockResolvedValue({ ok: true, cafe: MIYABI, stamps: 5, complete: false, stamps_added: 2, bonus_applied: true, carry_over: 0 });
  const tree = await start();
  const before = sb.wheelStatus.mock.calls.length;
  await press(tree, "+1 Miyabi");
  await until(() => text(tree).includes("Dubbelstämpel hos Miyabi"), "+2-arket");
  await tick(1200);   // andra nedslaget
  expect(text(tree)).toContain("+2");
  expect(sb.wheelStatus.mock.calls.length).toBe(before + 1);
  expect(text(tree)).not.toContain("Dubbelstämpel aktiv");   // förbrukad
});

test("fullt kort med överskott: firandet säger att stämpeln följer med", async () => {
  sb.tapToken.mockResolvedValue({ ok: true, cafe: MIYABI, stamps: 7, complete: true, stamps_added: 2, bonus_applied: true, carry_over: 1 });
  const tree = await start();
  await press(tree, "+1 Miyabi");
  await tick(800);
  await until(() => text(tree).includes("Kortet är fullt!"), "firandet");
  expect(text(tree)).toContain("1 stämpel sparad till nästa kort");
});

test("vanlig stämpel som förut", async () => {
  sb.tapToken.mockResolvedValue({ ok: true, cafe: MIYABI, stamps: 4, complete: false, stamps_added: 1, bonus_applied: false, carry_over: 0 });
  const tree = await start();
  const before = sb.wheelStatus.mock.calls.length;
  await press(tree, "+1 Miyabi");
  await until(() => text(tree).includes("Stämpel hos Miyabi"), "+1-arket");
  expect(text(tree)).not.toContain("Dubbelstämpel hos");
  expect(sb.wheelStatus.mock.calls.length).toBe(before);
});

test("hjulfliken: hämta vinst → tillbaka till korten med besked", async () => {
  sb.wheelStatus.mockResolvedValue(STATUS({ can_spin: false, prize: { spin_id: "spin-7", claim_until: future(40), offers: [{ cafe: BRYGGAN, stamps: 0, is_new: true }] } }));
  sb.claimWheelPrize.mockResolvedValue({ ok: true, cafe: BRYGGAN, expires_at: future(40), stamps: 0 });
  const tree = await start();
  sb.loadWallet.mockResolvedValue([
    { cafe: MIYABI, stamps: 3, pending: false, bonus_expires_at: null },
    { cafe: BRYGGAN, stamps: 0, pending: false, bonus_expires_at: future(40) },
  ]);
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Dagens hjul") && text(tree).includes("Du har en dubbelstämpel att hämta"), "hjulfliken");
  await press(tree, "Välj ställe");
  await until(() => text(tree).includes("Använd hos Bryggans Bageri"), "vinstarket");
  await press(tree, "Använd hos Bryggans Bageri");
  expect(sb.claimWheelPrize).toHaveBeenCalledWith("spin-7", "bryggan");
  await until(() => text(tree).includes("Dina kort") && text(tree).includes("Dubbelstämpel hos Bryggans Bageri"), "tillbaka till korten");
  expect(text(tree)).toContain("Nästa stämpel där ger 2");
  expect(text(tree)).toContain("Dubbelstämpel aktiv");
});

test("hjälpknappen på hjulfliken öppnar reglerna", async () => {
  const tree = await start();
  await press(tree, "Hjul");
  await until(() => text(tree).includes("Snurra"), "hjulfliken");
  const help = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === "Regler för Dagens hjul" && typeof n.props.onPress === "function")[0];
  await act(async () => { help.props.onPress(); });
  await until(() => text(tree).includes("Apple och Google är inte sponsorer"), "reglerna");
  await press(tree, "Kort");
  await flush();
  expect(text(tree)).not.toContain("Apple och Google");
});

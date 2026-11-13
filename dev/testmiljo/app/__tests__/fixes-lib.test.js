// Riktiga src/lib/supabase.js — bara nätanropet (supabase.rpc) är utbytt.
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.setTimeout(60000);

test("getDeviceId: samtidiga anrop vid första start får samma id som sparas", async () => {
  await AsyncStorage.clear();
  const lib = require("../src/lib/supabase");
  const used = [];
  jest.spyOn(lib.supabase, "rpc").mockImplementation(async (fn, args) => {
    used.push([fn, args.p_device_id]);
    return { data: fn === "load_wallet" ? [] : { ok: true }, error: null };
  });
  // Kallstart via tagglänk: taggens tap_token och appstartens hämtningar samtidigt.
  await Promise.all([lib.tapToken("miyabi-01"), lib.loadWallet(), lib.wheelStatus()]);
  const stored = await AsyncStorage.getItem("tappass.device_id");
  expect(new Set(used.map(([, id]) => id)).size).toBe(1);
  expect(used.find(([fn]) => fn === "tap_token")[1]).toBe(stored);
  expect(await lib.getDeviceId()).toBe(stored);
});

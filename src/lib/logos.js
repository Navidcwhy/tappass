// Butikens logga (v13). Butiken laddar upp den i panelen; appen hämtar den med
// cafe_logo(slug) när cafes.logo_version ändras och sparar den i AsyncStorage, så att
// den syns direkt (och utan nät) nästa gång. version 0 = ingen logga.
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCafeLogo } from "./supabase";

const KEY = (slug) => "tappass.logo." + slug;
const mem = new Map();        // slug → { v, uri }
const inflight = new Map();   // slug:version → Promise<uri|null>

async function load(slug, version) {
  const hit = mem.get(slug);
  if (hit && hit.v === version) return hit.uri;
  try {
    const raw = await AsyncStorage.getItem(KEY(slug));
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && saved.v === version && typeof saved.uri === "string") {
      mem.set(slug, saved);
      return saved.uri;
    }
  } catch {}
  const r = await getCafeLogo(slug);
  if (!r || !r.ok) return hit ? hit.uri : null;   // nätfel: behåll en äldre logga om vi har en
  const uri = r.data && r.mime ? "data:" + r.mime + ";base64," + r.data : null;
  const entry = { v: Number(r.version) || 0, uri };
  mem.set(slug, entry);
  try {
    if (uri) await AsyncStorage.setItem(KEY(slug), JSON.stringify(entry));
    else await AsyncStorage.removeItem(KEY(slug));
  } catch {}
  return uri;
}

export function loadLogo(slug, version) {
  if (!slug || !version) return Promise.resolve(null);
  const k = slug + ":" + version;
  if (!inflight.has(k)) inflight.set(k, load(slug, version).finally(() => inflight.delete(k)));
  return inflight.get(k);
}

// Loggans data-URI, eller null (ingen logga / inte hämtad än).
export function useLogo(slug, version) {
  const v = Number(version) || 0;
  const [uri, setUri] = useState(() => {
    const hit = slug ? mem.get(slug) : null;
    return hit && hit.v === v ? hit.uri : null;
  });
  useEffect(() => {
    let alive = true;
    if (!slug || !v) { setUri(null); return undefined; }
    loadLogo(slug, v).then((u) => { if (alive) setUri(u); }).catch(() => {});
    return () => { alive = false; };
  }, [slug, v]);
  return v ? uri : null;
}

export const _resetLogoCache = () => { mem.clear(); inflight.clear(); };   // för test

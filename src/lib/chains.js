// Kedjekort (v18): en kedja är en rad i cafes med is_chain = true och äger kortet (namn, färg,
// belöning). Ställena är rader med chain_id = kedjans id och har egna adresser och öppettider.
// Ställen med delat kort visas under kedjan, inte som egna rader. Ett ställe med eget kort
// (own_card, egen belöning som TapPass satt) visas som ett vanligt ställe.

// Ett ställe i kedjan, från load_wallet (stores) eller en cafes-rad
export function storeFields(s) {
  if (!s) return null;
  return {
    slug: s.slug,
    name: s.name || "",
    area: s.area || "",
    address: s.address || "",
    openingHours: Array.isArray(s.opening_hours) ? s.opening_hours : (Array.isArray(s.openingHours) ? s.openingHours : []),
    website: s.website || "",
    logoVersion: Number(s.logo_version ?? s.logoVersion) || 0,
  };
}

// Listan under Ställen: kedjor får sina ställen (sorterade på namn), ställen med delat kort tas bort.
// Utan v18 saknas fälten och listan är oförändrad.
export function placesWithChains(cafes) {
  const list = Array.isArray(cafes) ? cafes : [];
  const members = {};
  for (const c of list) {
    if (c && c.chainId && !c.ownCard) (members[c.chainId] = members[c.chainId] || []).push(storeFields(c));
  }
  return list
    .filter((c) => c && !(c.chainId && !c.ownCard))
    .map((c) => (c.isChain
      ? { ...c, stores: (members[c.uuid] || []).sort((a, b) => a.name.localeCompare(b.name, "sv")) }
      : c));
}

export function chainText(n) {
  return "Gäller på " + n + (n === 1 ? " ställe" : " ställen");
}

// Under namnet: "Kafé · Gäller på 3 ställen" för en kedja, annars "Kafé · Vasastan"
export function metaText(c) {
  const stores = c && Array.isArray(c.stores) ? c.stores : null;
  return [c && c.type, stores && stores.length ? chainText(stores.length) : c && c.area].filter(Boolean).join(" · ");
}

// Sökningen hittar kedjan på ställenas namn och områden ("Södermalm")
export function searchText(c) {
  const stores = c && Array.isArray(c.stores) ? c.stores : [];
  return [c.name, c.area, c.type, ...stores.flatMap((s) => [s.name, s.area])]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
}

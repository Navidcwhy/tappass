import { act, create } from "react-test-renderer";

export const flush = async (n = 4) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve(); }); };
export const until = async (cond, label) => {
  for (let i = 0; i < 300; i++) { if (cond()) return; await flush(1); }
  throw new Error("Tidsgräns: " + label);
};
export const tick = async (ms) => { await act(async () => { jest.advanceTimersByTime(ms); }); await flush(); };

let mounted = [];
export const mount = async (el) => { let t; await act(async () => { t = create(el); }); mounted.push(t); return t; };
export const unmountAll = async () => { for (const t of mounted) await act(async () => { t.unmount(); }); mounted = []; };

const collect = (node, out) => {
  if (node == null) return;
  if (typeof node === "string") { out.push(node); return; }
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return; }
  const kids = node.children || [];
  if (kids.length && kids.every((c) => typeof c === "string")) { out.push(kids.join("")); return; }
  kids.forEach((c) => collect(c, out));
};
export const text = (tree) => { const out = []; collect(tree.toJSON(), out); return out.join(" ¦ "); };

// Hitta tryckbart element som innehåller en viss text (sista träffen = innersta).
const ownText = (x) => {
  const c = x.props && x.props.children;
  if (typeof c === "string") return c;
  if (Array.isArray(c) && c.every((k) => typeof k === "string" || typeof k === "number")) return c.join("");
  return null;
};
export const findPressable = (tree, label) => {
  const hits = tree.root.findAll((n) => n.props && typeof n.props.onPress === "function" &&
    n.findAll((x) => { const s = ownText(x); return s != null && s.includes(label); }).length > 0);
  return hits[hits.length - 1];
};
export const press = async (tree, label) => {
  const el = findPressable(tree, label);
  if (!el) throw new Error("Hittar ingen knapp: " + label);
  await act(async () => { el.props.onPress(); });
};
export const byLabel = (tree, label) => tree.root.findAll((n) => n.props && n.props.accessibilityLabel === label && typeof n.props.onPress === "function")[0];

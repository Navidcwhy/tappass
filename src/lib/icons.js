import React from "react";
import {
  CreditCard, MapPin, CircleHelp, X, Check, ArrowRight, Nfc, Search, Gift, Timer,
  WifiOff, CircleAlert, Smartphone, Keyboard, RotateCcw, ChevronsRight, ChevronRight,
  Megaphone, Info, Link, Share2, ScanLine, FerrisWheel, ChevronDown, RotateCw, ExternalLink,
  Coffee, Croissant, Utensils, Leaf, IceCream, PiggyBank,
} from "lucide-react-native";

const CAFE = { coffee: Coffee, croissant: Croissant, utensils: Utensils, leaf: Leaf, icecream: IceCream };

const MAP = {
  card: CreditCard, pin: MapPin, help: CircleHelp, close: X, check: Check, arrow: ArrowRight,
  nfc: Nfc, search: Search, gift: Gift, timer: Timer, wifiOff: WifiOff, alert: CircleAlert,
  phone: Smartphone, keyboard: Keyboard, reset: RotateCcw, chevrons: ChevronsRight,
  chev: ChevronRight, megaphone: Megaphone, info: Info, link: Link, share: Share2, scan: ScanLine,
  wheel: FerrisWheel, chevDown: ChevronDown, spin: RotateCw, external: ExternalLink,
  piggy: PiggyBank,
  ...CAFE,
};

export const Icon = ({ name, size = 22, color = "#1B1C17", strokeWidth = 2 }) => {
  const C = MAP[name];
  if (!C) return null;
  return <C size={size} color={color} strokeWidth={strokeWidth} />;
};

export const CafeIcon = ({ symbol, size = 24, color = "#1B1C17", strokeWidth = 2 }) => {
  const C = CAFE[symbol] || Coffee;
  return <C size={size} color={color} strokeWidth={strokeWidth} />;
};

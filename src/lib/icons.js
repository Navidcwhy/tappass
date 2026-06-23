import React from "react";
import {
  Home, Compass, Plus, Gift, Coffee, Croissant, Utensils, Leaf, IceCream,
  ChevronRight, X, Search, Clock, MapPin, Check, Sparkles, Wifi, ArrowUpRight,
  Lock, Unlock, ScanLine, RotateCw, Star,
} from "lucide-react-native";

const CAFE = { coffee: Coffee, croissant: Croissant, utensils: Utensils, leaf: Leaf, icecream: IceCream };

export const Icon = ({ name, size = 22, color = "#1A1612", strokeWidth = 1.6 }) => {
  const map = {
    home: Home, compass: Compass, plus: Plus, gift: Gift,
    chev: ChevronRight, close: X, search: Search, clock: Clock, pin: MapPin,
    check: Check, sparkles: Sparkles, wifi: Wifi, arrowOut: ArrowUpRight,
    lock: Lock, unlock: Unlock, scan: ScanLine, rotate: RotateCw, star: Star,
    ...CAFE,
  };
  const C = map[name];
  if (!C) return null;
  return <C size={size} color={color} strokeWidth={strokeWidth} />;
};

export const CafeIcon = ({ symbol, size = 24, color = "#1A1612", strokeWidth = 1.6 }) => {
  const C = CAFE[symbol] || Coffee;
  return <C size={size} color={color} strokeWidth={strokeWidth} />;
};

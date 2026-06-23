import { T } from "./theme";

// id -> business. Tag URL: https://tappass.se/t/<id>
export const TAG_REGISTRY = {
  linnea:   { id: "linnea",   name: "Kafé Linnéa",     type: "Kafé",       area: "Vasastan",    dist: 320,  symbol: "coffee",    reward: "En kaffe på huset",       rewardShort: "Gratis kaffe",       needed: 9,  ...T.cafePalette.linnea },
  bryggan:  { id: "bryggan",  name: "Bryggans Bageri", type: "Bageri",     area: "Södermalm",   dist: 1500, symbol: "croissant", reward: "En kanelbulle på huset",   rewardShort: "Gratis kanelbulle",  needed: 8,  ...T.cafePalette.bryggan },
  saluhall: { id: "saluhall", name: "Saluhall 22",     type: "Restaurang", area: "Östermalm",   dist: 850,  symbol: "utensils",  reward: "20% rabatt på lunch",      rewardShort: "20% på lunch",       needed: 6,  ...T.cafePalette.saluhall },
  tehuset:  { id: "tehuset",  name: "Tehuset Mira",    type: "Tehus",      area: "Gamla stan",  dist: 2400, symbol: "leaf",      reward: "En kanna chai på huset",   rewardShort: "Gratis chai",        needed: 10, ...T.cafePalette.tehuset },
  glassbar: { id: "glassbar", name: "Polka Glassbar",  type: "Glassbar",   area: "Kungsholmen", dist: 600,  symbol: "icecream",  reward: "En glasskula på huset",    rewardShort: "Gratis kula",        needed: 7,  ...T.cafePalette.glassbar },
};

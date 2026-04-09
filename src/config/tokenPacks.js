/**
 * Same pack definitions as placetowebsite — each credit = download passes / license units.
 */
export const TOKEN_PACKS = [
  {
    id: "pack_1",
    credits: 1,
    amountUsd: 5,
    label: "Starter",
    description: "Try the downloader with one pass.",
    popular: false,
  },
  {
    id: "pack_5",
    credits: 5,
    amountUsd: 20,
    label: "Builder",
    description: "Five download passes.",
    popular: false,
  },
  {
    id: "pack_10",
    credits: 10,
    amountUsd: 35,
    label: "Growth",
    description: "Best value for regular use.",
    popular: true,
  },
  {
    id: "pack_20",
    credits: 20,
    amountUsd: 60,
    label: "Studio",
    description: "Heavy usage.",
    popular: false,
  },
  {
    id: "pack_40",
    credits: 40,
    amountUsd: 100,
    label: "Agency",
    description: "Maximum passes.",
    popular: false,
  },
];

export const TOKEN_PACK_MAP = Object.fromEntries(TOKEN_PACKS.map((p) => [p.id, p]));

export const VALID_PRODUCT_TYPES = ["go_live", ...TOKEN_PACKS.map((p) => p.id)];

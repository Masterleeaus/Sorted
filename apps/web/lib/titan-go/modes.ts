export type TitanGoMode = "build" | "desk" | "field" | "pay";

export type TitanGoModeMeta = Readonly<{
  id: TitanGoMode;
  label: string;
  shortLabel: string;
  outcome: string;
  colour: string;
}>;

export const TITAN_GO_MODES: Readonly<Record<TitanGoMode, TitanGoModeMeta>> = Object.freeze({
  build: Object.freeze({ id: "build", label: "Titan Zero Build", shortLabel: "Build", outcome: "Build the business", colour: "#4d8dff" }),
  desk: Object.freeze({ id: "desk", label: "Titan Zero Desk", shortLabel: "Desk", outcome: "Run the front office", colour: "#ef5350" }),
  field: Object.freeze({ id: "field", label: "Titan Zero Field", shortLabel: "Field", outcome: "Run the work", colour: "#f5c542" }),
  pay: Object.freeze({ id: "pay", label: "Titan Zero Pay", shortLabel: "Pay", outcome: "Get paid", colour: "#44c767" }),
});

/**
 * Titan Go is one installable PWA. Product subscriptions determine which modes
 * are available inside that PWA. This repository is the Field product, so Field
 * is the default/current mode until subscription entitlements are wired in Core.
 */
export const CURRENT_TITAN_GO_MODE: TitanGoMode = "field";
export const CURRENT_TITAN_GO_MODE_META = TITAN_GO_MODES[CURRENT_TITAN_GO_MODE];

import { normalizeSurface, type CanonicalProductSurface } from "@titan-zero/titan-platform/interface-registry";

export type HostSurface = Exclude<CanonicalProductSurface, "onboarding">;
type NavItem = readonly [label: string, href: string];

const HOST_NAVIGATION: Readonly<Record<HostSurface, readonly NavItem[]>> = Object.freeze({
  zero: [["Chat", "/app/zero"], ["Control", "/app/control"], ["Workforce", "/app/workforce"], ["Decisions", "/app/decisions"], ["System", "/app/system"]],
  go: [["Chat", "/app/go"], ["Active", "/app/go/active"], ["Today", "/app/go/today"], ["Comms", "/app/go/comms"], ["Ready", "/app/go/ready"]],
  hub: [["Chat", "/app/hub"], ["My Services", "/app/hub/services"], ["Support", "/app/hub/support"], ["Account", "/app/hub/account"]],
});

export function normalizeHostSurface(value: string): HostSurface {
  const surface = normalizeSurface(value);
  if (surface === "onboarding") throw new Error("unsupported host surface: onboarding");
  return surface;
}

export function projectHostNavigation(value: string) {
  const surface = normalizeHostSurface(value);
  return Object.freeze(
    HOST_NAVIGATION[surface].map(([label, href]) =>
      Object.freeze({ label, href, surface, authority: "navigation-only" as const }),
    ),
  );
}

import type {
  IntelligenceCapability,
  IntelligenceModel,
  IntelligenceProvider,
  IntelligenceRequest,
  IntelligenceRoute,
} from "./intelligence-runtime/index.js";

const localityRank: Record<IntelligenceProvider["locality"], number> = { device: 0, customer_edge: 1, local_bridge: 2, byo: 3, customer_service: 4, titan_entitled: 5, titan_metered: 6 };

export type IntelligenceHealth = "healthy" | "degraded" | "unavailable";

export type IntelligenceProviderAvailability = Readonly<{
  provider: IntelligenceProvider;
  health: IntelligenceHealth;
  available: boolean;
  company_id: string;
  locality: IntelligenceProvider["locality"];
  cost: Readonly<{ titanFunded: boolean; metered: boolean }>;
  externalEgress: boolean;
  authorityGranted: false;
}>;

export type IntelligenceModelAvailability = Readonly<{
  model: IntelligenceModel;
  providerId: string;
  capabilities: readonly IntelligenceCapability[];
  available: boolean;
  company_id: string;
  authorityGranted: false;
}>;

export type IntelligenceAvailabilityProjection = Readonly<{
  schema: "titan.intelligence.availability.v1";
  company_id: string;
  providers: readonly IntelligenceProviderAvailability[];
  models: readonly IntelligenceModelAvailability[];
  authorityGranted: false;
}>;

export type IntelligenceProjectionInput = Readonly<{
  company_id: string;
  providers: readonly IntelligenceProvider[];
  models: readonly IntelligenceModel[];
  health?: Readonly<Record<string, IntelligenceHealth>>;
}>;

function requireCompany(company_id: string) {
  if (!company_id) throw new Error("company_id-required");
}

function stable<T extends string>(values: readonly T[]) {
  return [...new Set(values)].sort() as T[];
}

export function buildIntelligenceAvailabilityProjection(input: IntelligenceProjectionInput): IntelligenceAvailabilityProjection {
  requireCompany(input.company_id);
  const providers = input.providers.filter((provider) => provider.company_id === input.company_id);
  const providerIds = new Set(providers.map((provider) => provider.id));
  const providerViews = providers
    .map((provider) => {
      const health = input.health?.[provider.id] ?? (provider.enabled && !provider.revoked ? "healthy" : "unavailable");
      return Object.freeze({
        provider: Object.freeze({ ...provider, capabilities: stable(provider.capabilities) }),
        health,
        available: provider.enabled && !provider.revoked && health !== "unavailable",
        company_id: input.company_id,
        locality: provider.locality,
        cost: Object.freeze({ titanFunded: provider.titanFunded, metered: provider.metered }),
        externalEgress: provider.external,
        authorityGranted: false as const,
      });
    })
    .sort((a, b) => a.provider.id.localeCompare(b.provider.id));
  const models = input.models
    .filter((model) => model.company_id === input.company_id && providerIds.has(model.providerId))
    .map((model) => Object.freeze({
      model: Object.freeze({ ...model, capabilities: stable(model.capabilities) }),
      providerId: model.providerId,
      capabilities: stable(model.capabilities),
      available: model.enabled && !model.revoked && providerViews.some((view) => view.provider.id === model.providerId && view.available),
      company_id: input.company_id,
      authorityGranted: false as const,
    }))
    .sort((a, b) => a.model.id.localeCompare(b.model.id));
  return Object.freeze({ schema: "titan.intelligence.availability.v1" as const, company_id: input.company_id, providers: providerViews, models, authorityGranted: false as const });
}

export function selectIntelligenceAvailabilityRoute(
  request: IntelligenceRequest,
  projection: IntelligenceAvailabilityProjection,
): IntelligenceRoute {
  if (request.company_id !== projection.company_id) throw new Error("projection-cross-company-denied");
  const providerById = new Map(projection.providers.map((view) => [view.provider.id, view]));
  const candidates = projection.models
    .filter((view) => view.available && view.capabilities.includes(request.capability))
    .map((modelView) => {
      const providerView = providerById.get(modelView.providerId);
      if (!providerView || !providerView.available) return null;
      const denied = providerView.externalEgress && request.allowExternal !== true;
      const restricted = request.privacy === "restricted" && providerView.externalEgress;
      const managed = providerView.locality === "titan_entitled" && request.allowTitanManaged !== true;
      const metered = providerView.cost.metered && request.allowMetered !== true;
      if (denied || restricted || managed || metered) return null;
      return { provider: providerView.provider, model: modelView.model, rank: localityRank[providerView.provider.locality], reasons: [`health:${providerView.health}`, `locality:${providerView.locality}`, "authority:neutral"] };
    })
    .filter((candidate): candidate is { provider: IntelligenceProvider; model: IntelligenceModel; rank: number; reasons: string[] } => candidate !== null)
    .sort((a, b) => a.rank - b.rank || a.provider.id.localeCompare(b.provider.id));
  const winner = candidates[0];
  if (!winner) throw new Error("no-available-intelligence-route");
  return { ...winner, authorityGranted: false };
}

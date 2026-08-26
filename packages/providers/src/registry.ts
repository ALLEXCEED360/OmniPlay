import type { GamingProvider, ProviderId } from '@omniplay/types';
import { SteamProvider } from './steam/steam.provider.js';
import { XboxProvider } from './xbox/xbox.provider.js';
import { OpenXblProvider } from './xbox/openxbl.provider.js';
import { PsnProvider } from './psn/psn.provider.js';
import { ImportProvider, type ImportRecordLoader } from './import/import.provider.js';
import {
  IMPORT_PROVIDER_IDS,
  PROVIDER_CATALOGUE,
  findCatalogueEntry,
  missingRequirements,
  type ProviderCatalogueEntry,
} from './catalogue.js';

/**
 * The provider registry.
 *
 * This is the seam that makes spec 33 true in practice: the API and the worker
 * ask the registry for "the provider called xbox" and never import an adapter
 * directly. Adding Epic is a new adapter plus one line here.
 *
 * Providers are registered only when their configuration is present, so a
 * developer without an Xbox app registration still gets a working Steam-only
 * instance rather than a boot failure.
 */
export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, GamingProvider>();

  register(provider: GamingProvider): this {
    this.providers.set(provider.id, provider);
    return this;
  }

  /** Returns the adapter, or undefined if the provider is not configured. */
  find(id: ProviderId): GamingProvider | undefined {
    return this.providers.get(id);
  }

  /** Returns the adapter or throws - for paths where absence is a bug. */
  get(id: ProviderId): GamingProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(
        `Provider "${id}" is not configured on this instance. Configured: ${this.ids.join(', ') || 'none'}`,
      );
    }
    return provider;
  }

  has(id: ProviderId): boolean {
    return this.providers.has(id);
  }

  get ids(): ProviderId[] {
    return [...this.providers.keys()];
  }

  list(): GamingProvider[] {
    return [...this.providers.values()];
  }

  /** What the UI needs to render the connect screen and privacy matrix. */
  describe() {
    return this.list().map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      capabilities: provider.capabilities,
    }));
  }

  /**
   * Every known platform, configured or not.
   *
   * The connect screen renders this rather than `describe()`, so a provider
   * missing its credentials appears with setup instructions instead of
   * vanishing — which is what previously left a user staring at an empty
   * library with no idea a key was needed.
   */
  catalogue(env: Record<string, string | undefined> = {}) {
    return PROVIDER_CATALOGUE.map((entry) => {
      const provider = this.find(entry.id);
      const missing = missingRequirements(entry, env);

      return {
        id: entry.id,
        displayName: entry.displayName,
        access: entry.access,
        configured: provider !== undefined,
        capabilities: provider?.capabilities ?? null,
        missingEnv: missing,
        setupUrl: entry.setupUrl ?? null,
        setupHint: entry.setupHint ?? null,
        importReason: entry.importReason ?? null,
        exportUrl: entry.exportUrl ?? null,
      };
    });
  }
}

export interface ProviderRegistryEnv {
  STEAM_API_KEY?: string | undefined;
  STEAM_REALM?: string | undefined;
  XBOX_CLIENT_ID?: string | undefined;
  XBOX_CLIENT_SECRET?: string | undefined;
  OPENXBL_API_KEY?: string | undefined;
  PSN_NPSSO?: string | undefined;
}

export interface ProviderRegistryDeps {
  /**
   * Supplies pending import records. Without it the file-backed providers are
   * not registered, since they would have nothing to read.
   */
  loadImportRecords?: ImportRecordLoader;
}

/** Builds the registry from environment configuration. */
export function createProviderRegistry(
  env: ProviderRegistryEnv,
  deps: ProviderRegistryDeps = {},
): ProviderRegistry {
  const registry = new ProviderRegistry();

  if (env.STEAM_API_KEY && env.STEAM_REALM) {
    registry.register(
      new SteamProvider({ apiKey: env.STEAM_API_KEY, realm: env.STEAM_REALM }),
    );
  }

  // Two routes to the same Xbox data. OpenXBL wins when configured: it needs
  // only an API key, whereas the direct route needs an Azure tenant that a
  // personal Microsoft account does not have. Both satisfy the same interface,
  // so nothing downstream can tell which one answered.
  if (env.OPENXBL_API_KEY) {
    registry.register(new OpenXblProvider({ apiKey: env.OPENXBL_API_KEY }));
  } else if (env.XBOX_CLIENT_ID) {
    registry.register(
      new XboxProvider({
        clientId: env.XBOX_CLIENT_ID,
        clientSecret: env.XBOX_CLIENT_SECRET,
      }),
    );
  }

  // PlayStation, when a session token is present.
  //
  // Unofficial by necessity: Sony publishes no consumer API, so this speaks to
  // the endpoints behind the PlayStation mobile app. It registers only when
  // PSN_NPSSO is set, which keeps that a deliberate choice rather than a
  // default - and without it PlayStation stays the file import below.
  if (env.PSN_NPSSO) {
    registry.register(new PsnProvider({ npsso: env.PSN_NPSSO }));
  }

  // File-backed sources need no credentials, so they register as soon as a
  // loader exists. Ubisoft and EA are here rather than as API clients because
  // neither publishes a public consumer API to build one against (spec 5.3,
  // and the same reasoning extended).
  //
  // Adding each of them is one catalogue entry and no new adapter, which is
  // the provider abstraction earning its keep.
  if (deps.loadImportRecords) {
    for (const id of IMPORT_PROVIDER_IDS) {
      const entry = findCatalogueEntry(id);
      if (!entry) continue;
      registry.register(buildImportProvider(entry, deps.loadImportRecords));
    }
  }

  return registry;
}

/** Constructs the import-backed adapter for a catalogue entry. */
function buildImportProvider(
  entry: ProviderCatalogueEntry,
  loadRecords: ImportRecordLoader,
): ImportProvider {
  return new ImportProvider({
    id: entry.id,
    displayName: entry.displayName,
    loadRecords,
  });
}

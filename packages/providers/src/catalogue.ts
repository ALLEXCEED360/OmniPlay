import type { ProviderId } from '@omniplay/types';

/**
 * Every platform OMNIPLAY knows about, configured or not.
 *
 * This exists because of a real failure: with no credentials set, the registry
 * only ever contained the import-backed providers, so Steam and Xbox did not
 * appear in the UI *at all*. A user looking at an empty library had no way to
 * discover that a key was missing, let alone which one.
 *
 * So the catalogue is the full known set, and the registry reports which of
 * them are actually wired up. An unconfigured provider is shown with the exact
 * variable it needs and where to get it, rather than silently omitted.
 */

export type ProviderAccess =
  /** A real API OMNIPLAY can call once credentials exist. */
  | 'api'
  /** No public API exists; data arrives as a file the user supplies. */
  | 'import';

export interface ProviderCatalogueEntry {
  id: ProviderId;
  displayName: string;
  access: ProviderAccess;
  /** Environment variables that must be set for `access: 'api'` providers. */
  requires: string[];
  /** When true, any one of `requires` is enough rather than all of them. */
  requiresAnyOf?: boolean;
  /** Where to obtain those credentials. */
  setupUrl?: string;
  /** One or two sentences shown in the UI when the provider is unconfigured. */
  setupHint?: string;
  /** Why there is no API, for `access: 'import'` providers. */
  importReason?: string;
  /** Where the user can request their data from the platform. */
  exportUrl?: string;
}

export const PROVIDER_CATALOGUE: ProviderCatalogueEntry[] = [
  {
    id: 'steam',
    displayName: 'Steam',
    access: 'api',
    requires: ['STEAM_API_KEY', 'STEAM_REALM'],
    setupUrl: 'https://steamcommunity.com/dev/apikey',
    setupHint:
      'Register a Steam Web API key, then set STEAM_API_KEY. Your Steam profile and "Game details" must be set to Public, or Steam will not share your library with anyone — including us.',
  },
  {
    id: 'xbox',
    displayName: 'Xbox',
    access: 'api',
    // Either route satisfies Xbox; `missingRequirements` treats this as
    // "any one of", not "all of".
    requires: ['OPENXBL_API_KEY', 'XBOX_CLIENT_ID'],
    requiresAnyOf: true,
    setupUrl: 'https://xbl.io',
    setupHint:
      'Easiest route: get a free API key at xbl.io and set OPENXBL_API_KEY. A personal Microsoft account cannot create an Azure app registration, so the direct route needs an Azure tenant first.',
  },
  {
    id: 'psn',
    displayName: 'PlayStation',
    access: 'import',
    requires: [],
    importReason:
      'Sony publishes no public consumer API. The community endpoints that exist are reverse-engineered, unsupported, and break without notice, so OMNIPLAY does not build on them.',
    exportUrl: 'https://www.playstation.com/support/account/request-personal-information/',
  },
  {
    id: 'ubisoft',
    displayName: 'Ubisoft Connect',
    access: 'import',
    requires: [],
    importReason:
      'Ubisoft publishes no public consumer API. The community endpoints require your account password rather than an authorisation flow, which OMNIPLAY will not ask for.',
    exportUrl: 'https://www.ubisoft.com/en-us/help/account/article/requesting-your-personal-data',
  },
  {
    id: 'ea',
    displayName: 'EA',
    access: 'import',
    requires: [],
    importReason:
      'EA publishes no public consumer API for the EA app, and the former Origin endpoints were never supported for third parties.',
    exportUrl: 'https://myaccount.ea.com/cp-ui/aboutme/index',
  },
  {
    id: 'manual',
    displayName: 'Manual entry',
    access: 'import',
    requires: [],
    importReason:
      'For physical copies, retro consoles, and anything else you want on record.',
  },
];

/** Providers whose data arrives as a file rather than over an API. */
export const IMPORT_PROVIDER_IDS: ProviderId[] = PROVIDER_CATALOGUE.filter(
  (entry) => entry.access === 'import',
).map((entry) => entry.id);

export function findCatalogueEntry(id: ProviderId): ProviderCatalogueEntry | undefined {
  return PROVIDER_CATALOGUE.find((entry) => entry.id === id);
}

/** Which of an entry's required variables are absent from the environment. */
export function missingRequirements(
  entry: ProviderCatalogueEntry,
  env: Record<string, string | undefined>,
): string[] {
  const missing = entry.requires.filter((name) => !env[name]);

  // "Any one of" is satisfied as soon as a single variable is present, so an
  // instance using OpenXBL is not told it is missing the Azure client id.
  if (entry.requiresAnyOf && missing.length < entry.requires.length) return [];
  return missing;
}

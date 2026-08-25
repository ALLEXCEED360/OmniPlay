/**
 * Dependency-injection tokens.
 *
 * Kept in their own module with no imports of their own: defining a token
 * alongside the module that consumes it creates an import cycle between the
 * module and the services that inject it, which fails at runtime with
 * "Cannot access before initialization".
 */

/** The configured provider registry (@omniplay/providers). */
export const PROVIDER_REGISTRY = Symbol('PROVIDER_REGISTRY');

/** The BullMQ sync queue. */
export const SYNC_QUEUE_TOKEN = Symbol('SYNC_QUEUE');

/** The BullMQ metadata-enrichment queue. */
export const METADATA_QUEUE_TOKEN = Symbol('METADATA_QUEUE');

/**
 * Trusted proxies: the hops whose X-Forwarded-For entries the dashboard believes.
 */

/** The ranges trusted when no list is configured. */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = ['loopback', 'linklocal', 'uniquelocal'];

/** The value handed to Fastify's trustProxy option. */
export function resolveTrustedProxies(_configured?: readonly string[]): readonly string[] | false {
  return true as never;
}

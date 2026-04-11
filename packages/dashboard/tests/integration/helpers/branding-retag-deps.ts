/**
 * Test helper — builds a real `BrandingOrchestrator` for integration tests
 * that exercise `retagScansForSite` / `retagAllSitesForGuideline`.
 *
 * Phase 18-04 extended those functions from 3 args to 5 args. Integration
 * tests that historically used arbitrary `orgId` strings (e.g. `org-retag-test`)
 * without seeding the `organizations` table would now throw from
 * `OrgRepository.getBrandingMode`, which FAILS FAST on missing rows.
 *
 * This helper sidesteps the problem by injecting a stub `OrgRepository` that
 * always reports `'embedded'` mode — the only mode integration tests have
 * ever exercised. The real `EmbeddedBrandingAdapter` is still used for both
 * slots, so matching semantics (brandMatch flowing through to the JSON
 * report) remain EXACTLY as they were pre-18-04. The remote adapter slot is
 * filled with the same embedded adapter but is never reached (mode is always
 * 'embedded').
 *
 * Tests that need remote-mode behavior should build their own orchestrator
 * with a real `RemoteBrandingAdapter` and a seeded org row.
 */

import type { StorageAdapter } from '../../../src/db/index.js';
import type { OrgRepository } from '../../../src/db/interfaces/org-repository.js';
import type { BrandScoreRepository } from '../../../src/db/interfaces/brand-score-repository.js';
import { BrandingOrchestrator } from '../../../src/services/branding/branding-orchestrator.js';
import { EmbeddedBrandingAdapter } from '../../../src/services/branding/embedded-branding-adapter.js';

/**
 * A minimal stub OrgRepository that only implements `getBrandingMode`,
 * always returning `'embedded'`. All other methods throw — the orchestrator
 * does not call them during matchAndScore.
 */
function makeEmbeddedOnlyOrgRepository(): OrgRepository {
  const unsupported = (name: string) => () => {
    throw new Error(`test stub OrgRepository: ${name} not implemented`);
  };
  return {
    getBrandingMode: async () => 'embedded' as const,
    setBrandingMode: unsupported('setBrandingMode'),
    // The remaining OrgRepository methods are unused by BrandingOrchestrator
    // but must satisfy the interface. Cast through unknown to keep the
    // helper file type-safe without re-declaring every signature.
  } as unknown as OrgRepository;
}

export interface RetagTestDeps {
  readonly brandingOrchestrator: BrandingOrchestrator;
  readonly brandScoreRepository: BrandScoreRepository;
}

/**
 * Builds the two extra arguments needed by `retagScansForSite` /
 * `retagAllSitesForGuideline`. Pass them positionally as args 4 and 5.
 */
export function makeRetagDeps(storage: StorageAdapter): RetagTestDeps {
  const orgRepository = makeEmbeddedOnlyOrgRepository();
  const embedded = new EmbeddedBrandingAdapter();
  const brandingOrchestrator = new BrandingOrchestrator(
    orgRepository,
    embedded,
    embedded, // remote slot unused because mode is always 'embedded'
  );
  return {
    brandingOrchestrator,
    brandScoreRepository: storage.brandScores,
  };
}

import { useLogger } from '../helpers/logger/index.js';
import emitter from '../emitter.js';
import { ApplicationEnrichmentService } from '../services/ai/applications/application-enrichment-service.js';

const logger = useLogger();

/**
 * Hook to enrich application with grant data when application is created
 * This runs asynchronously and doesn't block application creation
 */
export async function enrichApplicationOnCreate(meta: any, _context: any) {
  const { key, collection } = meta;

  // Only process applications table
  if (collection !== 'applications') {
    return;
  }

  try {
    // Get the created application data
    const payload = meta['payload'];
    const grantId = payload?.grant_id;
    const applicationId = key;

    if (!grantId || !applicationId) {
      logger.debug(`Application ${applicationId} created without grant_id, skipping enrichment`);
      return;
    }

    logger.info(`Application ${applicationId} created for grant ${grantId}, starting async enrichment`);

    // Run enrichment asynchronously (fire and forget)
    // This won't block the application creation response
    setImmediate(async () => {
      try {
        const enrichmentService = new ApplicationEnrichmentService();

        const success = await enrichmentService.enrichAndUpdateApplication({
          application_id: applicationId,
          grant_id: grantId,
        });

        if (success) {
          logger.info(`Application ${applicationId} successfully enriched from grant ${grantId}`);
        } else {
          logger.info(`Application ${applicationId} enrichment skipped or failed (non-critical)`);
        }
      } catch (enrichError) {
        // Log error but don't throw - enrichment failure shouldn't break application creation
        logger.error(enrichError, `Error enriching application ${applicationId}:`);
      }
    });

    logger.info(`Application ${applicationId} enrichment queued (async)`);
  } catch (error) {
    // Log but don't throw - enrichment errors shouldn't block application creation
    logger.error(error, `Error in application enrichment hook for ${key}:`);
  }
}

/**
 * Register all application hooks
 */
export function registerApplicationHooks() {
  // Listen for application creation
  emitter.onAction('applications.items.create', enrichApplicationOnCreate);

  logger.info('Application enrichment hooks registered');
}

// Auto-register hooks when this module is imported
registerApplicationHooks();

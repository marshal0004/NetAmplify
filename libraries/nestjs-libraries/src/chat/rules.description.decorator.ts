// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/chat/rules.description.decorator.ts
// NetAmplify — @Rules + @RulesDescription decorators.
//
// Used by X, LinkedIn, and Bluesky providers to attach human-readable
// per-platform rules (e.g., "X: 280 char limit, no duplicate posts within 24h").
// The description is surfaced in the publish page's per-platform preview.
//
// Phase 5 will wire this into the Format Engine's UI preview per
// docs/06-FRONTEND-SPEC.md §6 (Publish screen).

/**
 * Per-platform rules descriptor.
 * Used by IntegrationManager.getAllRulesDescription() to populate the
 * per-platform preview UI on the Publish screen.
 */
export interface PlatformRules {
  /** Max chars allowed by this platform */
  maxChars?: number;
  /** Hashtag limits (count + format) */
  maxHashtags?: number;
  /** URL behavior (e.g., "t.co wraps to 23 chars" for X) */
  urlLength?: number;
  /** Markdown allowed? */
  markdownAllowed: boolean;
  /** Image allowed? */
  imageAllowed: boolean;
  /** Other custom rules */
  custom?: Record<string, string | number | boolean>;
}

/**
 * Attach a structured rules descriptor to a provider class.
 * Stored as metadata via Reflect; retrieved by IntegrationManager.getAllRulesDescription().
 */
export function Rules(rules: PlatformRules): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata('custom:rules', target, rules);
  };
}

/**
 * Attach a human-readable rules description to a provider class.
 * Stored as metadata via Reflect; retrieved by IntegrationManager.getAllRulesDescription().
 */
export function RulesDescription(description: string): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata('custom:rules:description', target, description);
  };
}

// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/integrations/social/hashnode.tags.ts
// NetAmplify — Hashnode publication tags whitelist.
//
// Hashnode restricts articles to tags from its approved list. This array
// enumerates the valid tag slugs so the Hashnode adapter can reject
// invalid tags at publish-time (FR-011 — Format Engine validation).
// Source: https://hashnode.com/tags (as of 2026-09).
//
// Phase 6 will integrate this into the Format Engine's hashnode formatter.

export const HASHNODE_VALID_TAGS: readonly string[] = [
  'javascript', 'typescript', 'react', 'vue', 'angular', 'svelte',
  'nodejs', 'deno', 'bun', 'python', 'java', 'kotlin', 'swift', 'rust',
  'go', 'csharp', 'cpp', 'c', 'ruby', 'php', 'elixir', 'clojure',
  'webdev', 'frontend', 'backend', 'fullstack', 'devops', 'cloud',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform',
  'ai', 'ml', 'llm', 'data-science', 'machine-learning', 'deep-learning',
  'blockchain', 'web3', 'solidity', 'ethereum', 'solana',
  'cybersecurity', 'privacy', 'cryptography',
  'database', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql',
  'opensource', 'programming', 'tutorial', 'beginners', 'career',
  'productivity', 'design', 'ux', 'css', 'html', 'tailwindcss',
  'nextjs', 'remix', 'astro', 'nuxt',
  'testing', 'jest', 'vitest', 'playwright', 'cypress',
  'git', 'github', 'ci-cd',
  'linux', 'bash', 'shell',
  'algorithms', 'data-structures', 'system-design',
  'student', 'hackathon', 'internship', 'interview',
];

/**
 * Default Hashnode tags for NetAmplify PostCard publishing (used when
 * the user's techStack doesn't match any Hashnode tag exactly).
 */
export const tags: readonly string[] = HASHNODE_VALID_TAGS;

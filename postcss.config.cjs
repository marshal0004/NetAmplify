// NetAmplify — PostCSS config (empty, test-runner guard).
//
// NetAmplify has no CSS pipeline of its own (the backend is NestJS; the
// frontend's Vite config handles its own PostCSS). This empty config exists
// solely so Vite — when invoked by Vitest for node-environment unit tests —
// resolves a LOCAL postcss config and does NOT walk up the directory tree to
// find a parent project's incompatible Tailwind v4 PostCSS config, which
// previously aborted the test run with "Invalid PostCSS Plugin found".
//
// Tests import no CSS, so an empty plugins array is correct.
module.exports = { plugins: [] };

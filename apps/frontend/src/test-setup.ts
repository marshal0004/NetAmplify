// Vitest test setup — loaded before every frontend test file
// (vite.config.ts → test.setupFiles: ['./src/test-setup.ts']).
//
// Registers @testing-library/jest-dom DOM matchers (toBeInTheDocument,
// toHaveValue, toBeVisible, …) used by component tests. Pure-function tests
// (errors.test.ts, MediaPreview.test.ts) don't use these matchers, but the
// setup file MUST exist — without it vitest fails to load any test file with
// "Failed to load url …/src/test-setup.ts. Does the file exist?".
//
// (Cleanup of rendered components between tests is automatic: vitest with
// globals:true + @testing-library/react auto-runs cleanup in afterEach.)

import '@testing-library/jest-dom';

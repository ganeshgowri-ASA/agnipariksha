/**
 * Node entry. Used by tooling that needs to intercept fetch outside of
 * the browser (e.g. node-driven unit tests, future SSR fetches in dev).
 *
 * Playwright itself drives a real Chromium and goes through the browser
 * worker, so this is reserved for tests that import handlers directly.
 */
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);

# Integration smoke tests

End-to-end smoke tests for Agnipariksha, powered by [Playwright](https://playwright.dev/).

These tests do **not** require the ITECH PV6000 or a running backend — all
`/api/device/status` requests are mocked inside each spec via
`page.route()`. The frontend dev server is started automatically by the
Playwright `webServer` config (or reused if it is already on
`http://localhost:3000`).

## Run locally

```bash
cd tests
npm install
npm run install:browsers   # one-time: download Chromium
npm test
```

Open the HTML report:

```bash
npm run report
```

## CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) executes
`npm test` inside this folder after building the frontend.

## Adding a new test

Put new specs in `e2e/<feature>.spec.ts`. Mock backend calls with
`page.route('**/api/<route>', …)` instead of starting the real backend —
these are smoke tests, not integration tests against live SCPI.

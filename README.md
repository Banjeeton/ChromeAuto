# Chrome Automation Extension

Private Google Chrome extension for recording, editing and running website
automations in the user's current browser tabs.

## Development environment

Required versions:

- Node.js 24 LTS;
- npm 11.

The expected versions are also declared in `package.json`. The `.nvmrc` file
selects the Node.js 24 release line when a compatible version manager is used.

Check the active environment:

```powershell
node --version
npm --version
```

Install the exact dependency versions from `package-lock.json`:

```powershell
npm ci
```

Run the project checks:

```powershell
npm run verify
```

Individual checks are available through `npm run typecheck` and `npm test`.

## Technical spikes

- [Playwright CRX](docs/playwright-crx-spike.md)

## Quality assurance

- [Preset Management MVP manual regression checklist](docs/preset-management-regression.md)

## Local manual-test preset

The portable preset
[`examples/presets/local-manual-test.preset.json`](examples/presets/local-manual-test.preset.json)
is ready to import from the side panel. It targets
`http://localhost:4173/playwright-crx-fixture.html` and verifies click, human
input, element waits, custom JavaScript, the in-page HTML modal, reload and log
output.

Run `npm run build`, reload the unpacked `dist` extension, start
`npm run preview`, open the fixture URL and import the preset manually.

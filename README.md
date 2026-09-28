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

## Documentation

- [Architecture](docs/architecture.md)
- [Portable preset v1 format](docs/preset-format.md)

## Technical spikes

- [Playwright CRX](docs/playwright-crx-spike.md)

## Quality assurance

- [Preset Management MVP manual regression checklist](docs/preset-management-regression.md)
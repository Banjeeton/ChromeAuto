# E2E-тестирование unpacked extension

E2E-набор запускает production-сборку расширения в чистом профиле настоящего
Chromium. Папка `dist` подключается через `--load-extension` и
`--disable-extensions-except`, поэтому тестируется тот же unpacked-артефакт,
который устанавливается вручную через `chrome://extensions`.

## Подготовка

После `npm ci` один раз установить совместимую версию Chromium:

```powershell
npm run test:e2e:install
```

## Запуск

Полный E2E-набор, включая production-сборку:

```powershell
npm run test:e2e
```

Для визуальной диагностики с открытым окном Chromium:

```powershell
npm run test:e2e:headed
```

Полный автоматический gate Vitest + E2E:

```powershell
npm run verify:all
```

## Покрытие

`tests/e2e/extension-flow.spec.ts` проверяет:

- загрузку `dist` как unpacked extension;
- локальные HTTP- и HTTPS fixture-страницы;
- Create → Save → Run через side panel;
- Record → reload → HTML modal → Edit → Save → Run;
- Dashboard и Run log;
- repeat и его остановку кнопкой Stop;
- два независимых запуска во вкладках и Stop All.

Локальный сервер `scripts/e2e-fixture-server.mjs` обслуживает production fixture
по HTTP на порту `4173` и по HTTPS на порту `4174`. Сертификат создаётся только
на время запуска; приватные ключи не сохраняются в репозитории.

При падении Playwright сохраняет screenshot и trace в `test-results/e2e`.
Артефакты диагностики не включаются в Git.

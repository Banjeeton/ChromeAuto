# Аудит permissions и custom JavaScript

Дата аудита: 2026-09-30.

## Manifest V3 permissions

| Permission | Использование | Почему необходимо |
| --- | --- | --- |
| `alarms` | `ChromeAlarmScheduler`, восстановление repeat-циклов | Надёжные минутные таймеры при остановке service worker; `setTimeout` для этого не используется |
| `debugger` | Подключение Playwright CRX к выбранной вкладке | Выполнение шагов в уже открытом браузере пользователя |
| `scripting` | Fallback-инъекция recorder loader | Восстановление Recorder, если content script ещё не подключён |
| `sidePanel` | `chrome.sidePanel.setPanelBehavior` и основной UI | Открытие постоянной панели расширения |
| `storage` | presets в `local`, runtime в `session` | Локальное хранение без внешней базы данных |
| `tabs` | active-tab query, URL/title, lifecycle и messaging | Dashboard, точная hostname-проверка, независимые вкладки и понятная блокировка `chrome://` страниц |
| `webNavigation` | main-frame documentId, committed/page-ready events | Продолжение Recorder после reload без дублирования шага |

`host_permissions` ограничены `http://*/*` и `https://*/*`, потому что preset
может быть назначен любому явно выбранному пользователем сайту. Разрешений
`cookies`, `history`, `downloads`, `clipboardRead`, `clipboardWrite`,
`management` и доступа к `file://` нет. Неиспользуемых permissions в manifest
по результатам аудита не обнаружено.

## Custom JavaScript

- Recorder не создаёт `customCode` из событий страницы. Такой шаг появляется
  только после ручного выбора типа шага в редакторе либо после ручного импорта
  preset v1.
- Первый Run всегда ручной. Repeat может продолжить этот запуск только после
  явного включения repeat в preset.
- Dashboard предупреждает о custom JavaScript перед Run; оба редактора
  показывают предупреждение рядом с исходным кодом.
- Код выполняется в контексте текущей HTTP/HTTPS-страницы и считается доверенным
  пользовательским кодом. Запрещённые Chrome pages, extension pages и другие
  неподдерживаемые схемы отклоняются до запуска.
- Ошибки custom code не переносят page-provided message и stack в Run log.
  Журнал получает стабильное диагностическое сообщение. Значения текущих
  `input[type=password]` заменяются на `[REDACTED]` в result, `automation.log`,
  stop reason, message и stack ещё внутри page context.

## Recorder, журнал и экспорт

- Recorder игнорирует input-события `type=password`; значение не попадает во
  внутреннее событие, draft или preset.
- Run log повторно редактирует password/passwd/pwd, token, authorization и
  cookie-подобные пары, обрезает diagnostics и скрывает URL query/hash.
- Экспортёр читает только валидный `PresetV1`. Cookies API не запрашивается;
  tabId, sessionId, alarms, Recorder state, request journal, quarantine и прочий
  runtime в JSON отсутствуют.
- Пользовательский `customCode.source` является частью portable automation и
  экспортируется дословно. Поэтому UI отдельно запрещает помещать в исходный
  код пароли, cookies или токены.

## Остаточные ограничения

Расширение не является sandbox для недоверенного JavaScript: вручную добавленный
или импортированный код имеет доступ к DOM страницы в пределах разрешённого
сайта. Безопасная модель — запускать только понятный пользователю код и
проверять импортируемый preset перед Run.

# Localisation

The extension's pages, toolbar tooltip, notifications, the question popover agents show in pages, and store description follow the browser's language. It ships in every language the Chrome Web Store supports. English is the default and the source for the other languages.

Tool results, errors returned to the agent, and the prompt the setup page gives you to paste into an agent stay in English, because agents read them, not you.

## Where the text lives

Each language has one file, `extensions/browser/public/_locales/<code>/messages.json`, in Chrome's [message format](https://developer.chrome.com/docs/extensions/reference/api/i18n). The build copies the folder into the package as is. Safari reads the same files.

`en/messages.json` is the reference. Its `description` fields tell translators where each message appears; the other files hold only `message`.

| Used from | How |
| --- | --- |
| `manifest.json` | `__MSG_extDescription__` and `__MSG_actionTitle__`. `default_locale` is `en`. The name, Agent Browser Bridge, is not translated. |
| HTML pages | `data-i18n="key"` replaces the element's text. `data-i18n-placeholder`, `data-i18n-aria-label` and `data-i18n-title` set those attributes. `data-i18n-arg` passes one fixed value as `$1`, such as an app name. |
| TypeScript | `t(key, ...values)` and `plural(base, count, ...values)` from `extensions/browser/src/i18n/messages.ts`. Keys are checked against `en/messages.json` at compile time. |

`localizePage()` in `extensions/browser/src/i18n/page.ts` runs first on each page. It also sets `lang` and `dir` from the language of the messages, so Arabic, Hebrew and Persian lay out from right to left. Chrome's own `@@bidi_dir` follows Chrome's interface language instead, which can differ, so the extension keeps its own list of right-to-left languages in `messages.ts`. Add to it when adding another right-to-left language.

### Elements inside a message

Some sentences contain code or a link, such as "Changes made with `chrome_plan_apply` can be reverted". The HTML keeps those child elements, and the message refers to them as `$1`, `$2` and so on, in the order they appear in the HTML. A translation can move them anywhere in the sentence. `localizePage` puts the original elements back where the translation places them, so their own content and attributes stay as they are.

### Plurals

Chrome's messages have no plural support, so a message that depends on a number has one key per [plural category](https://cldr.unicode.org/index/cldr-spec/plural-rules): `chatUnseen_one`, `chatUnseen_other`, and in languages that need them `_zero`, `_two`, `_few` and `_many`. `plural()` picks the key with `Intl.PluralRules` for the count, which is always `$1`, and falls back to `_other`.

### Times and numbers

Relative times such as "5 minutes ago" come from `Intl.RelativeTimeFormat`, clock times from `toLocaleTimeString`, and counts from `toLocaleString`. All of them use the language of the messages Chrome picked, read from the `locale` message, not the browser's language. So a browser set to a language the extension lacks gets English text with English dates, not a mix.

## Adding or changing text

1. Add the message to `en/messages.json` with a `description`.
2. Use it from HTML or TypeScript as above.
3. Add it to every other `messages.json`. Until a language has it, `npm test` fails, and Chrome would show the English text.

When you change the meaning of an English message, update the translations too, or ask for them to be updated.

## Checks

`extensions/browser/src/i18n/locales.test.ts` runs with `npm test`. For each language it checks that:

- the folder name is a locale Chrome supports, and the `locale` message matches it,
- every English key is present and not empty,
- the plural keys cover every category `Intl.PluralRules` reports for the language,
- each message uses the same `$1`, `$2` substitutions as English, and a literal `$` is written `$$`,
- `extDescription` is at most 132 characters, Chrome's limit.

It also fails when an English message is unused, or a page asks for a key that does not exist.

`e2e/localisation/localisation.test.ts` starts Chromium in German and Arabic and checks the setup page in each, including the code and links inside translated sentences and the right-to-left layout. Chromium on macOS ignores `--lang` and follows the system language order instead, so the test is skipped on macOS and runs on Linux, as in CI.

## Trying another language

On Linux and Windows, start Chrome with `--lang=de`. On macOS, Chrome follows the system language order: add the language to the top of Language & Region in System Settings, or set it for Chrome alone under Applications in that pane, then restart Chrome.

## Review

The translations other than English were written without a native speaker review. Have the most important languages checked before relying on them, and fix any message in its `messages.json`.

Open questions from the translation:

- Safari's names for Settings > Extensions come from memory and are least certain in `ms`, `uk` and `ar`. Where macOS has no interface in the language (`fa`, `fil`, `sw`, `am`, `et`, `lv`, `lt`, `sr`, `sl`), the path stays in English. The Indian languages other than `hi` translate it, which may not match what Safari shows.
- Register: `de` uses Sie and `zh_CN` uses 您, while the store screenshot captions in `store/screenshots/locales/` use du and 你. The example prompts on the setup page use the informal form people type to an agent.
- `bn` and `mr` number the setup steps with their own digits, while the other Indian languages use 1 and 2.
- Remote access: "relay" has no settled term. It is kept as a loanword in some languages (`de`, `it`, `nl`, `ja`, `ko`) and translated as a relay or forwarding server in others (`es`, `pt_BR`, `ru`, `zh_CN`), which makes some switch labels long. "Token" is least certain in `ca`, `fi`, `et`, `lv`, `lt` and `el`. "Revoke" reads like "Cancel" in `he`, `hi`, `bn`, `gu`, `mr` and `ms`. The word order of "Created $1" is least certain in `zh_CN`, `zh_TW`, `ja`, `hu` and `fa`.
- Words with no settled Chrome term, chosen from memory: "agent" (`zh_CN` 智能体, `tr` ajan) and "extension" or "tab" in `kn`, `ml` and `ta`. In the Indian languages the example profile name "Work" is rendered as "Office".

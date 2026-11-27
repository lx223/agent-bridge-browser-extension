# Asking the user in the page

`browser_ask_user` lets the agent ask you to confirm something without you switching back to its window. The question appears in a small popover in the tab the agent is working in, and your click goes straight back to the agent.

The agent uses it for yes or no decisions about what it is about to do, such as submitting a form, sending a message, buying something or deleting something. If a [browser chat](chat.md) is open, the agent asks there instead.

## What you see

- The tab comes to the front and its window gets focus.
- A popover appears in the top right corner of the page, or the top left in right-to-left languages. It shows which agent is asking, the question and two buttons: **Cancel** and a confirm button, which the agent can label, such as **Submit order**.
- In Chrome, a desktop notification also appears and stays until you answer. Clicking it brings you to the tab.
- Drag the popover by its top bar to move it out of the way.
- After you click, the popover says what was sent to the agent, then closes.

The popover follows your system's light or dark mode, not the website's, with the same colours as the setup page and chat panel. `ask.ts` passes it `extensions/browser/src/theme.css` with `:root` changed to the card, so the website's own CSS cannot change those colours. Its own text, such as "claude-code asks" and the default button labels, is in the extension's language (see [Localisation](localisation.md)). The question and any button labels the agent chose are in whatever language the agent wrote them.

The buttons ignore clicks for the first moment after the popover appears, so a click meant for the page does not land on them by accident.

## What the agent gets back

The tool waits for your answer and returns one of:

| answer | meaning |
| --- | --- |
| `confirmed` | You clicked the confirm button. Only this lets the agent go ahead. |
| `cancelled` | You clicked **Cancel**. |
| `navigated` | The page changed or reloaded before you answered, so the question is gone. |
| `tabClosed` | You closed the tab. |
| `timeout` | Nobody answered within `timeoutSeconds` (2 minutes by default, at most 10). The popover is removed. |
| `expired` | The browser lost the question, for example because the extension restarted. |

Each answer comes with a `next` line telling the agent what to do with it.

## Parameters

| parameter | |
| --- | --- |
| `browser` | `chrome` or `safari`. Required, because tab ids only mean something within one browser. Instance names are per browser too, so `instance` alone cannot pick the browser. |
| `message` | The question, saying what will happen on confirm. |
| `title` | Optional short question shown in bold above the message. |
| `confirmLabel`, `cancelLabel` | Optional button labels. Default **Confirm** and **Cancel** in the extension's language. |
| `tabId` | Optional. Defaults to the active tab. |
| `instance` | Optional, as for the other tools, when several instances of the browser are connected. |
| `timeoutSeconds` | Optional, 1 to 600. |

A tab shows one question at a time. Asking again in a tab that is still waiting fails.

## How it works

The server shows the question with `ask.show`, then asks the extension for the answer with `ask.wait` in rounds of up to 20 seconds, sending MCP progress notifications in between so the agent's client keeps waiting. When the agent's call is cancelled or times out, the server sends `ask.cancel` and the popover is removed.

The popover is a closed shadow root at the end of the page. Its script runs in an isolated world, separate from the page's own scripts, and keeps the answer there. The page's scripts cannot read the answer or set it, and the buttons only accept clicks that the browser marks as coming from the user (`event.isTrusted`), so a page cannot confirm for you. `extensions/browser/src/background/popover.ts` holds the popover and `ask.ts` the rest. The popover's script runs in the page, where it cannot call `chrome.i18n`, so `ask.ts` translates its text with `t()` and passes it in, together with the text direction.

- **Chrome** creates the isolated world with the `debugger` permission the page tools already use (`Page.createIsolatedWorld`), so Chrome shows its debugging banner while the question is up. It needs no new permission.
- **Safari** has no debugger, so it injects the same functions with `scripting.executeScript`, which also runs in an isolated world. The Safari build adds the `scripting` permission and asks for access to websites (`<all_urls>`), which Safari lets you grant per website. A question in a tab on a website you have not allowed fails.

The extension reads the answer every quarter of a second while the server waits. When the isolated world has gone, because the page navigated or reloaded, the answer is `navigated`.

## Limits

- **The website can see the question.** The popover is part of the page, so the website can read its text or remove it. The agent must not put secrets in it. If the page removes it, the answer is `navigated`.
- **Some pages cannot show it**, such as `chrome://` pages, the Chrome Web Store and other extensions' pages. The tool then fails and the agent asks elsewhere.
- **Focus.** Some operating systems do not let the browser take focus from the agent's window. The tab still comes to the front within the browser, and in Chrome the notification tells you a question is waiting.
- **Restarts.** Questions are kept in memory. If the extension restarts or updates while one is open, the agent gets `expired` and asks again.

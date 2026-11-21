# Chatting with your agent from the browser

The chat panel lets you keep talking to an agent from Chrome's side panel, so you don't have to switch back to the agent's window between steps. The agent posts its progress, results and questions there, and your replies go straight back to it.

## Start a chat

Start it from the agent, once:

- run the server's `continue_in_browser` prompt (in Claude Code, type `/continue_in_browser` and pick it from the list), or
- tell the agent "let's continue in the browser chat".

The agent posts a message with `browser_chat_send`. The toolbar button shows a badge with the number of messages you haven't read. If no chat panel is open, Chrome also shows a desktop notification. Click the toolbar button to open the panel: while a chat is open, the button opens the chat panel instead of the setup page. The panel's **Setup** link still opens the setup page.

Chrome only lets an extension open its side panel after you click something, so the agent can't open the panel for you.

## Talking in the panel

- **Enter** sends your message and **Shift+Enter** starts a new line.
- The status line under the title shows whether the agent is **waiting for your reply**, **working**, **disconnected** (its session has closed) or the chat has **ended**. While it works, it also shows the last browser tool it used.
- You can write while the agent is working. Messages wait until it next checks the chat. Each one shows **not read yet** until the agent reads it, then **read by the agent**.
- Each agent session has its own conversation. With several, pick one from the list under the title; the list shows how many new messages each has.
- **End chat** tells the agent the chat is over. It stops using the chat tools and finishes its turn in its own window. Asking the agent to continue in the browser starts the conversation again.
- **Remove** deletes a conversation that has ended or whose agent has disconnected.

## How the agent hears you

MCP only lets the agent ask the server for things. The browser can't send the agent a message on its own, so the agent has to keep checking the chat:

1. `browser_chat_send` posts the agent's message and, by default, waits for your reply. The reply is the tool's result.
2. If no reply arrives within `timeoutSeconds` (90 by default), the tool returns with none and the agent calls `browser_chat_receive` to keep waiting.
3. While a chat is open, every other browser tool result ends with a line such as "The user sent a new message in the browser chat" when you have written something the agent hasn't read. The agent can then read it in the middle of a task.

Behind the tools, the server asks the extension for new messages in rounds of up to 20 seconds and sends MCP progress notifications between rounds. A message is handed to the agent again until the server confirms the agent read it, so a cancelled tool call doesn't lose it.

## Limits

- **The agent must be listening.** If the agent ends its turn instead of calling a chat tool, your messages wait in the panel until something makes it check again: you, in its own window, or the next browser tool it uses. The panel then shows the agent as working rather than waiting.
- **Permission prompts still appear in the agent's window.** If your agent asks before each tool call, you still switch back to approve them. Allowing this server's tools in your agent avoids that, and the agent then asks for confirmations in the chat.
- **A long chat is one long agent turn.** The agent's context grows with every message. Some agents limit how many tool calls a turn can make, and then pause until you tell them to continue in their own window.
- **Chrome only.** Safari has no side panel API, and an in-page chat for Safari is planned. The chat tools report this when only Safari is connected.
- With several Chrome profiles connected, the chat uses the instance the session last used, or the one passed as `instance`.

## Where messages are kept

Conversations are kept in the extension's session storage. They stay in memory, and Chrome clears them when it quits or when the extension updates or reloads. Each conversation keeps its last 500 messages, and the extension keeps the 20 most recently used conversations.

Your messages go only to the agent session the conversation belongs to, through the local bridge. Each message includes the title and URL of the tab you were looking at when you sent it, so the agent knows what "this page" means. Chat text is never included in usage analytics. See the [privacy policy](../PRIVACY.md).

Only extension pages can read the conversation or type into it; web pages cannot.

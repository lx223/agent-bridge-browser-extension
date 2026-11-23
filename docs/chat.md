# Chatting with your agent from the browser

The chat panel lets you keep talking to an agent from Chrome's side panel, so you don't have to switch back to the agent's window between steps. The agent posts its progress, results and questions there, and your replies go straight back to it.

## Start a chat

Start it from the agent, once:

- run the server's `continue_in_browser` prompt (in Claude Code, type `/continue_in_browser` and pick it from the list), or
- tell the agent "let's continue in the browser chat".

The agent posts a message with `browser_chat_send`. The toolbar button shows a badge with the number of messages you haven't read. If no chat panel is open, Chrome also shows a desktop notification. In Chrome, clicking the toolbar button always opens the chat panel. The gear button at the top of the panel opens the setup page.

Chrome only lets an extension open its side panel after you click something, so the agent can't open the panel for you.

## Which agent a conversation belongs to

Each chat call carries an `agentSessionId` and an `agentSessionName` that the agent chooses itself:

- **agentSessionId** is any stable string: the agent's own session id if it knows one, or a random UUID it makes up on its first chat call. It passes the same value on every later call.
- **agentSessionName** is a short name the user will recognise, such as the task the agent is working on. It titles the conversation in the panel.

The extension keeps one conversation per `agentSessionId`. The MCP connection can't identify the agent session on its own:

- **Shared servers:** Claude Desktop starts one bridge server for all of its Code sessions. Every Code session reports the same client name and the folders of all sessions together, and its tool calls carry nothing that tells sessions apart.
- **Restarts:** the server gets a new session id whenever the client restarts it.

An id the agent chooses and repeats covers both cases.

Older servers send no `agentSessionId`. Their conversations are keyed by the bridge's session id instead, as before.

## Talking in the panel

- **Enter** or the send button sends your message and **Shift+Enter** starts a new line. The message box grows as you write.
- The status line under the title shows whether the agent is **waiting for your reply**, **working**, **reconnecting** (its connection dropped a moment ago), **disconnected** (its session has closed) or the chat has **ended**. While it works, it also shows the last browser tool it used.
- You can write while the agent is working. Messages wait until it next checks the chat. Each one shows **not read yet** until the agent reads it, then **read by the agent**.
- Each agent session has its own conversation. With several, the title becomes a list: pick a conversation from it. The list shows how many new messages each has, with open chats first and chats that ended or whose agent disconnected under **Past chats**.
- The button next to the title is **End chat** while the chat runs and **Remove** once it is over. Once a chat is over, the message box is replaced by a note on how to chat again.
- **End chat** tells the agent the chat is over. It stops using the chat tools and finishes its turn in its own window. Asking the agent to continue in the browser starts the conversation again.
- **Remove** deletes a conversation that has ended or whose agent has disconnected.

## Appearance

The chat panel and the setup page follow the system's light or dark setting, which Chrome also passes to its side panel. They share one set of colours, defined in `extensions/browser/src/theme.css`.

## How the agent hears you

MCP only lets the agent ask the server for things. The browser can't send the agent a message on its own, so the agent has to keep checking the chat:

1. `browser_chat_send` posts the agent's message and, by default, waits for your reply. The reply is the tool's result.
2. If no reply arrives within `timeoutSeconds` (50 by default), the tool returns with none and the agent calls `browser_chat_receive` to keep waiting. The default stays under 60 seconds because many MCP clients stop a tool call after a minute. Claude Desktop does, and it then restarts the server, which also starts a new agent session. An agent whose client allows longer calls can pass up to 600.
3. While a chat is open, every other browser tool result ends with a line such as "The user sent a new message in the browser chat" when you have written something the agent hasn't read. The agent can then read it in the middle of a task.

Behind the tools, the server asks the extension for new messages in rounds of up to 20 seconds and sends MCP progress notifications between rounds. A message is handed to the agent again until the server confirms the agent read it, so a cancelled tool call doesn't lose it.

The server confirms what the agent read by sending a cursor: the number of the last message it read, and the id of the conversation that number belongs to. It sends the cursor when it waits for messages and also when it posts one, since an agent that writes back has read what came before. A new server starts without a cursor, so it may be handed the last messages again if the agent read them but hadn't confirmed it yet. Each conversation gets a new id when it is created, so if Chrome restarts or the conversation is removed while the agent session keeps running, the extension sees that the cursor belongs to a conversation that is gone and hands over the new conversation's messages from the start. The server then follows the new id. A server that sends no id gets the same treatment when its cursor is past the last message in the conversation.

## When the agent's connection drops

An agent's MCP client can restart the bridge server in the middle of a chat. Claude Desktop does this after any tool call that fails, including one that it stopped after 60 seconds. The new server is a new agent session with a new id.

When the agent passes its `agentSessionId`, its next chat call finds the same conversation, whichever server session it comes through. Until then, and for conversations without an `agentSessionId`, the extension does not close the conversation straight away when its session leaves:

1. For 10 minutes the panel shows the agent as **reconnecting**. You can keep writing, and your messages wait for the agent.
2. A conversation without an `agentSessionId` moves to a new session from the same agent if one joins in that time. The same agent means the same client name, such as `claude-code`, and the same project folder. The new session's first chat call then gets the messages the old one had not read.
3. After 10 minutes without such a session, the panel shows the agent as **disconnected**.

For conversations without an `agentSessionId`, that match is a best guess: two sessions of the same agent in the same folder look alike, so the conversation goes to whichever one uses the chat first.

## Limits

- **The agent must be listening.** If the agent ends its turn instead of calling a chat tool, your messages wait in the panel until something makes it check again: you, in its own window, or the next browser tool it uses. The panel then shows the agent as working rather than waiting.
- **Permission prompts still appear in the agent's window.** If your agent asks before each tool call, you still switch back to approve them. Allowing this server's tools in your agent avoids that, and the agent then asks for confirmations in the chat.
- **A long chat is one long agent turn.** The agent's context grows with every message. Some agents limit how many tool calls a turn can make, and then pause until you tell them to continue in their own window.
- **Chrome only.** Safari has no side panel API, and an in-page chat for Safari is planned. The chat tools report this when only Safari is connected.
- With several Chrome profiles connected, the chat uses the instance the session last used, or the one passed as `instance`.

## Where messages are kept

Conversations are kept in the extension's session storage. They stay in memory, and Chrome clears them when it quits. They are carried over when the extension updates itself, as [updates](updates.md#what-survives-an-update) describes. Each conversation keeps its last 500 messages. The extension keeps the 20 most recently used conversations, and drops a conversation a day after it ended or its agent disconnected.

Your messages go only to the agent session the conversation belongs to, through the local bridge. Each message includes the title and URL of the tab you were looking at when you sent it, so the agent knows what "this page" means. Chat text is never included in usage analytics. See the [privacy policy](../PRIVACY.md).

Only extension pages can read the conversation or type into it; web pages cannot.

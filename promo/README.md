# Promo video made with raea

`promo.tsx` is a 30-second, 1920×1080 promo video for Agent Browser Bridge, written as a [raea](https://github.com/shinyobjectz/raea) composition. raea renders React and TypeScript compositions to video on the GPU.

This is separate from the store assets in `store/assets/`. Those capture the real extension with Playwright. This video is drawn entirely by the composition and follows one story:

1. **Hook.** "Let your AI agent use the browser you already use."
2. **Tidy tabs.** The agent lists eight mixed tabs and groups them into Lisbon trip, Q3 report and Dinner ideas.
3. **Work in a page.** The agent opens Casa Azul, fills in the booking form, and asks with `browser_ask_user`. The in-page popover appears and you click **Book table**. The agent submits and confirms.
4. **End card.** The supported agents, "Free and open source", and Add to Chrome from the Chrome Web Store.

All of its copy comes from `store/assets/locales/en.json`, the README and the extension's English messages. The icon is the extension's app icon.

## Render it

Install raea (macOS on Apple Silicon, Linux x86_64 or Windows):

```bash
curl -fsSL https://raea.io/install | sh
```

From this folder:

```bash
raea render promo.tsx --quality master -o out/agent-browser-bridge-promo.mp4 --manifest out/render.json
```

```bash
raea check out/agent-browser-bridge-promo.mp4 --manifest out/render.json -o out/check.json
```

To check single frames without rendering the whole video:

```bash
raea render promo.tsx --at 40,250,560,820 -o out/frames/
```

`raea check` should report no errors or warnings. Renders go to `out/`, which git ignores.

raea's own export is large and on Linux it uses H.264 Constrained Baseline. To make a smaller copy that plays everywhere, for uploading:

```bash
ffmpeg -i out/agent-browser-bridge-promo.mp4 -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart out/agent-browser-bridge-promo-share.mp4
```

## Linux without a GPU

raea needs a Vulkan driver. On a machine or container without a GPU, Mesa's software driver works, at about 45 ms a frame:

```bash
sudo apt install mesa-vulkan-drivers libvulkan1
```

## Sound

The video has no audio track. raea can add music and sound effects, but its sound models and sample libraries were not set up when this was made.

## Editing

Scene timing is in the `BEAT` table in stage frames at 30 fps. The stage starts at composition frame `STAGE.from`. Captions, chat messages, the tab regrouping, the typing in the form and the cursor all read their timing from `BEAT`, so a change there moves everything that depends on it.

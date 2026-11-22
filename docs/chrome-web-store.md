# Chrome Web Store releases

Copy-ready dashboard fields and reviewer instructions live in [store/chrome/submission.md](../store/chrome/submission.md).

The store listing is managed in the [developer dashboard](https://chrome.google.com/webstore/devconsole/10394421-983d-4910-9716-1828882027b8/kmhcfgambmbglmgdjmdlkhcfkfpkddgb/edit).

## Store assets

`npm run store:assets` builds the extension and the MCP server, then writes every image and video both store listings use to `store/assets/out/`. That folder is not committed. The Safari files are described in the [Mac App Store submission copy](../store/safari/submission.md#screenshots-and-app-preview).

```bash
npm run store:assets
npm run store:assets -- --store chrome --locale de,ja
npm run store:assets -- --store chrome --locale en --kind screenshots --scene tabs,pages
npm run store:assets -- --store safari --kind video
npm run store:assets -- --out ~/Desktop/store-assets
```

| Option | Values | Default |
| --- | --- | --- |
| `--store` | `chrome`, `safari` | both |
| `--kind` | `screenshots`, `video`, `promo` (Chrome only) | all three |
| `--locale` | Chrome locale codes from `store/assets/locales/` | every locale |
| `--scene` | Chrome scenes: `tabs`, `pages`, `profiles`, `setup` | every scene |
| `--out` | any folder | `store/assets/out` |

The Chrome files go to `store/assets/out/chrome/`:

| File | Dashboard field | Shows |
| --- | --- | --- |
| `<locale>/1-tabs.png` | Screenshots, 1280x800 | An agent grouping open tabs by topic with `chrome_plan_apply` |
| `<locale>/2-pages.png` | Screenshots | An agent filling in and submitting a booking form |
| `<locale>/3-profiles.png` | Screenshots | An agent naming the browser profile, and the options popup showing the name |
| `<locale>/4-setup.png` | Screenshots | The setup page with an agent connected |
| `<locale>/promo-video.mp4` | Promo video, as a YouTube link | The four scenes played in order, between an opening and a closing title card |
| `promo/small-promo-tile-440x280.png` | Small promo tile | The icon, name and tagline |
| `promo/marquee-promo-tile-1400x560.png` | Marquee promo tile | The icon, name and tagline beside a set of tab groups |
| `promo/store-icon-128.png` | Store icon | The extension icon with the 16 pixel transparent border the store asks for |

Upload the screenshots for each language under Store listing in the developer dashboard. The number at the start of each file name gives its position in the listing. The promo tiles cannot be localised, so they are English only. The dashboard takes the promo video as a YouTube URL, so upload `promo-video.mp4` to YouTube and paste its link.

The script uses the end-to-end harness (`e2e/support/harness.ts`). Each scene comes from a real session: the built MCP server, the built extension in headless Chromium, and demo pages served on `127.0.0.1`. The tab groups, form contents, tool names and extension pages are what the extension actually produced, and every window state the video shows was captured at that point in the session. The caption, the chat transcript and the window frame around each capture are drawn by the script. Chromium starts with the locale's language, so the demo pages and the browser use it too. The extension's own pages are English only, because the extension is not localised yet.

Like the end-to-end tests, the script needs Playwright's Chromium installed. Videos also need `ffmpeg` with `libx264` on the `PATH`; leave out `--kind video` to skip them. Chinese, Japanese and Korean need CJK fonts on the machine. macOS and Windows have them; on Linux install a package such as `fonts-noto-cjk`. A full run takes about twenty minutes, most of it one Chrome video per locale; use `--locale` to render only the languages you are updating.

### Videos

Each video is 1920x1080, H.264 at 30 frames per second, with a silent stereo AAC track, which suits both YouTube and App Store app previews. The script renders the frames itself instead of recording the screen: it lays out every slide in one page, drives the CSS animations with the Web Animations API, sets the clock for each frame and pipes the screenshots into `ffmpeg`. The output is the same on every run and never drops a frame. Frames that do not change are captured once, so a long pause costs nothing.

In each scene the chat messages appear one at a time, and the window changes when the tool call that changed it appears. The timings are at the top of `store/assets/video.ts`.

### Locales

Each file in `store/assets/locales/` is one store language. The Chrome Web Store shows a listing's screenshots and promo video to people whose Chrome uses that language, so each locale reaches a region:

| File | Language | Main regions |
| --- | --- | --- |
| `en.json` | English (reference) | Every region without its own listing language |
| `de.json` | German | Germany, Austria, Switzerland |
| `es.json` | Spanish | Spain, Latin America |
| `fr.json` | French | France, Belgium, Canada, Switzerland |
| `id.json` | Indonesian | Indonesia |
| `it.json` | Italian | Italy |
| `ja.json` | Japanese | Japan |
| `ko.json` | Korean | South Korea |
| `nl.json` | Dutch | Netherlands, Belgium |
| `pl.json` | Polish | Poland |
| `pt_BR.json` | Brazilian Portuguese | Brazil |
| `ru.json` | Russian | Russia, Central Asia |
| `tr.json` | Turkish | Turkey |
| `zh_CN.json` | Simplified Chinese | Mainland China, Singapore |
| `zh_TW.json` | Traditional Chinese | Taiwan, Hong Kong |

Each file holds the captions, the chat transcript, the demo page text and the video's tagline and closing line. `en.json` is the reference, and the promo tiles use its tagline.

To add a language, copy `en.json` to a file named with a [Chrome Web Store locale code](https://developer.chrome.com/docs/extensions/reference/api/i18n#locales), such as `vi.json`, `pt_PT.json` or `es_419.json`, and translate every value. Keep placeholders such as `{tabs}` and keep the same number of entries in each list. The script and `npm test` both reject a file whose name is not a Chrome Web Store locale code, and a locale file with missing, extra or empty strings or with different placeholders. Right-to-left languages (`ar`, `fa`, `he`) are rejected too, because the layouts do not mirror yet. If a caption, transcript or title card is too long for its box, the script still writes the file but lists the text that was cut off and exits with an error, so shorten that text and run it again.

Chinese, Japanese and Korean text uses that language's own fonts, in `fontStack` in `store/assets/frame.ts`, so shared characters take the regional glyph shapes.

The translations other than English were written without a native speaker review. Have them checked before you publish them.

### Layout

| File | Holds |
| --- | --- |
| `store/assets/generate.ts` | The command line, and which files are written where |
| `store/assets/scenes.ts` | The Chrome scenes, driven through MCP tool calls. Each returns the chat messages and the window states, each state tagged with the message that produced it |
| `store/assets/safari.ts` | The Safari scenes and captions |
| `store/assets/frame.ts` | The caption, chat and window templates, and the screenshot and video layouts |
| `store/assets/video.ts` | The video timeline, animation and encoding |
| `store/assets/tiles.ts` | The promo tiles and store icon |
| `store/assets/demo.ts` | The demo pages, built from the locale strings |

To add a Chrome scene, add its name to `sceneNames` in `store/assets/locale.ts`, a caption for it in every locale file, and a capture function in `scenes.ts`. It then appears in the screenshots and the video.

## Release steps

1. Run the repository checks and the Publish Release workflow on the intended main commit.
2. Download the extension ZIP from that GitHub release and verify its manifest version.
3. Upload the ZIP under Package in the developer dashboard.
4. Review the description, permission justifications and data disclosures in the [submission copy](../store/chrome/submission.md) against the new package and privacy policy. If the release changes what the extension looks like or does, regenerate the [store assets](#store-assets) and upload them. Save the draft.
   The permissions added after 0.4.1 add install warnings: `history` and `sessions` ("Read and change your browsing history on all your signed-in devices"), `readingList`, `bookmarks`, `downloads`, `topSites` and `notifications`. `search` and `sidePanel` add none. When an update adds warnings like these, Chrome disables the extension for existing users until they accept it, so the bridge stays disconnected for them until then. Mention this in the release notes.
5. Submit for review. The 0.3.0 submission kept the existing tester distribution and enabled automatic publication after approval.
6. Verify that the dashboard reports Pending review. Submission does not mean the update is already published.

The MCP server is released separately through the Publish npm package workflow and any approval required on npm's staged packages page, after the new extension version is live in every store it is published in. See [npm publishing](npm-publishing.md#release-order) for the release order and its trusted publisher configuration.

# Chrome Web Store releases

Copy-ready dashboard fields and reviewer instructions live in [store/chrome/submission.md](../store/chrome/submission.md).

The store listing is managed in the [developer dashboard](https://chrome.google.com/webstore/devconsole/10394421-983d-4910-9716-1828882027b8/kmhcfgambmbglmgdjmdlkhcfkfpkddgb/edit).

## Screenshots

`npm run screenshots` builds the extension and the MCP server, then writes 1280x800 PNG screenshots for every locale to `store/screenshots/out/<locale>/`. That folder is not committed. Upload the files for each language under Store listing in the developer dashboard. The number at the start of each file name gives its position in the listing.

```bash
npm run screenshots
npm run screenshots -- --locale de,ja
npm run screenshots -- --locale en --scene tabs,pages
npm run screenshots -- --out ~/Desktop/store-screenshots
```

| File | Shows |
| --- | --- |
| `1-tabs.png` | An agent grouping open tabs by topic with `chrome_plan_apply` |
| `2-pages.png` | An agent filling in and submitting a booking form, with the page captured by `chrome_page_screenshot` |
| `3-profiles.png` | An agent naming the browser profile, and the options popup showing the name |
| `4-setup.png` | The setup page with an agent connected |

The script uses the end-to-end harness (`e2e/support/harness.ts`). Each screenshot comes from a real session: the built MCP server, the built extension in headless Chromium, and demo pages served on `127.0.0.1`. The tab groups, form contents, tool names and extension pages are what the extension actually produced. The caption, the chat transcript and the window frame around each capture are drawn by the script. Chromium starts with the locale's language, so the demo pages, the browser and the extension's own pages use it too. See [Localisation](localisation.md) for the extension's translations.

Like the end-to-end tests, the script needs port 17373 free and Playwright's Chromium installed. Japanese and Chinese need CJK fonts on the machine. macOS and Windows have them; on Linux install a package such as `fonts-noto-cjk`.

### Locales

Each file in `store/screenshots/locales/` is one store language, named with the Chrome Web Store locale code, such as `de.json`, `pt_BR.json` or `zh_CN.json`. It holds the captions, the chat transcript and the demo page text. `en.json` is the reference.

To add a language, copy `en.json` to the new code and translate every value. Keep placeholders such as `{tabs}` and keep the same number of entries in each list. The script and `npm test` both reject a locale file with missing, extra or empty strings, or with different placeholders. If a caption or transcript is too long for its box, the script still writes the file but lists the text that was cut off and exits with an error, so shorten that text and run it again.

The translations other than English were written without a native speaker review. Have them checked before you publish them.

### Layout

`store/screenshots/scenes.ts` drives each scene through MCP tool calls and returns the content for the frame. `store/screenshots/frame.ts` holds the caption, chat and window templates and their sizes. `store/screenshots/demo.ts` serves the demo pages built from the locale strings. To add a scene, add its name to `sceneNames` in `store/screenshots/locale.ts`, a caption for it in every locale file, and a capture function in `scenes.ts`.

## Languages and regions

The package ships translations for every language the store supports (see [Localisation](localisation.md)). The store reads the extension's name and summary from the package for each language. The detailed description and screenshots are per language in the dashboard under Store listing; a language without its own description shows the English one.

The detailed description for each language other than English is in [`store/chrome/descriptions/`](../store/chrome/descriptions), one file per locale code, such as `de.md` or `pt_BR.md`. Paste each file into that language's Store listing. The English text is in the [submission copy](../store/chrome/submission.md). The translations had no native speaker review; they use the same terms as the extension's `messages.json` for each language, so the open questions in [Localisation](localisation.md#review) apply to them too. When the English description changes, update every file.

Which countries can install the extension is a separate setting under Distribution > Regions, and does not depend on the languages. Keep it on all regions.

## Release steps

1. Run the repository checks and the Publish Release workflow on the intended main commit.
2. Download the extension ZIP from that GitHub release and verify its manifest version.
3. Upload the ZIP under Package in the developer dashboard.
4. Review the description, permission justifications and data disclosures in the [submission copy](../store/chrome/submission.md) against the new package and privacy policy. If the release changes what the extension looks like or does, regenerate the [screenshots](#screenshots) and upload them. Save the draft.
   The permissions added after 0.4.1 add install warnings: `history` and `sessions` ("Read and change your browsing history on all your signed-in devices"), `readingList`, `bookmarks`, `downloads`, `topSites` and `notifications`. `search` and `sidePanel` add none. When an update adds warnings like these, Chrome disables the extension for existing users until they accept it, so the bridge stays disconnected for them until then. Mention this in the release notes.
5. Submit for review. The 0.3.0 submission kept the existing tester distribution and enabled automatic publication after approval.
6. Verify that the dashboard reports Pending review. Submission does not mean the update is already published.

The MCP server is released separately through the Publish npm package workflow and any approval required on npm's staged packages page, after the new extension version is live in every store it is published in. See [npm publishing](npm-publishing.md#release-order) for the release order and its trusted publisher configuration.

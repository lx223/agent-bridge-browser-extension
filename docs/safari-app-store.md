# Mac App Store release for Safari

Safari extensions ship inside a macOS app. The app is listed in [App Store Connect](https://appstoreconnect.apple.com/apps) as **Agent Browser Bridge** (macOS, SKU `agent-browser-bridge`), on team `EV27867DV2`.

| Target | Bundle ID |
| --- | --- |
| App | `dev.agentbrowserbridge.app` |
| Safari extension | `dev.agentbrowserbridge.app.Extension` |

Both bundle IDs are registered under [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list).

## Release steps

1. Bump `packages/extension/package.json` to the new version and merge it.
2. Run the **Safari Archive** workflow from the Actions tab. It builds the extension, converts it to an Xcode project and runs `xcodebuild archive`.
3. Download the `agent-browser-bridge-safari-<version>-<run>` artifact and unzip it. Double-click `AgentBrowserBridge.xcarchive` to open it in Xcode's Organizer.
4. Choose **Distribute App > App Store Connect**. Xcode signs the app with the team's distribution certificate and uploads it. App Store Connect has no web upload for builds.
5. In App Store Connect, open the version that matches the archive, select the uploaded build, complete the listing and choose **Add for Review**.

## What the workflow sets

The converter does not produce a project the App Store accepts as is, so the workflow and `build:safari` adjust it:

- `scripts/set-safari-bundle-id.mjs` sets the app target's bundle ID to `dev.agentbrowserbridge.app`. Recent converters derive it from the app name instead, which breaks the extension's required `dev.agentbrowserbridge.app.` prefix.
- `MARKETING_VERSION` comes from `packages/extension/package.json` and `CURRENT_PROJECT_VERSION` is the workflow run number, so every upload has a new build number.
- `MACOSX_DEPLOYMENT_TARGET` is 12.0, matching the extension target, instead of the converter's default of the Xcode SDK version.
- `LSApplicationCategoryType` is `public.app-category.developer-tools`, which the Mac App Store requires.

The archive is signed ad hoc, so CI needs no Apple credentials. Xcode re-signs it with the distribution certificate when you distribute it.

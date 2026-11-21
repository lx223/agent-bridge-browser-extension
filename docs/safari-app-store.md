# Mac App Store releases

Safari only loads extensions that come inside a signed Mac app, so the Safari extension ships as the Agent Browser Bridge app on the Mac App Store. Copy-ready App Store Connect fields and reviewer instructions live in [store/safari/submission.md](../store/safari/submission.md).

The app is managed in [App Store Connect](https://appstoreconnect.apple.com/apps/6837496354/distribution) under team `EV27867DV2`:

| Field | Value |
| --- | --- |
| Apple ID | 6837496354 |
| SKU | agent-browser-bridge |
| App bundle ID | `dev.agentbrowserbridge.app` |
| Extension bundle ID | `dev.agentbrowserbridge.app.Extension` |

## How the app is built

`npm run build:safari -w agent-browser-bridge-extension` builds the extension and turns it into an Xcode project with Apple's `safari-web-extension-converter`. The project is generated on every build and not committed. `packages/extension/scripts/build-safari.mjs` then changes what the converter gets wrong for the App Store:

| Setting | Value | Why |
| --- | --- | --- |
| App bundle identifier | `dev.agentbrowserbridge.app` | The extension's identifier must start with the app's |
| Version (`MARKETING_VERSION`) | `version` in `packages/extension/package.json` | The App Store version matches the Chrome release |
| Build number (`CURRENT_PROJECT_VERSION`) | `--build-number`, default 1 | Every upload needs a new, higher build number |
| Minimum macOS (`MACOSX_DEPLOYMENT_TARGET`) | 14.0 | The converter uses the installed SDK's version, which would hide the app from older Macs |
| `LSApplicationCategoryType` | `public.app-category.developer-tools` | Required for App Store uploads |
| `ITSAppUsesNonExemptEncryption` | `NO` | The app uses no encryption beyond the system's, which skips the export compliance question |
| Extension `background` | `scripts: ["background.js"]`, `persistent: false` | Safari 27 does not run the MV3 service worker that Chrome uses; see [testing](testing.md#simulated-safari) |

The script understands both project formats the converter writes: `project.pbxproj` up to Xcode 26 and `project.xcproj` from Xcode 27. `npm run test:safari-app` checks the built app's Info.plist for these values, and presubmit runs it on every pull request.

The Safari app is released from a Mac, because signing it for the App Store needs an Apple account. Nothing is built or published by CI for it, and no Apple credential is stored on GitHub.

`npm run release:safari -w agent-browser-bridge-extension -- --team EV27867DV2` (`packages/extension/scripts/release-safari.mjs`):

1. builds the extension with the release analytics keys, the same ones the **Publish Release** workflow uses for the Chrome ZIP,
2. generates the Xcode project with a build number made from the current UTC time, such as `202611211235`, so every upload has a higher one; `--build-number` overrides it,
3. archives a Release build signed ad hoc,
4. signs the archive for the App Store with the Apple account signed in to Xcode and uploads it. The first time, Xcode creates an Apple Distribution certificate and the provisioning profiles.

Add `--no-upload` to write the signed package to `packages/extension/safari-release/` instead. Setting `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID` and `APP_STORE_CONNECT_KEY_PATH` signs with an App Store Connect API key instead of the Xcode account.

## One-time setup

1. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list), register the App IDs `dev.agentbrowserbridge.app` and `dev.agentbrowserbridge.app.Extension`.
2. In [App Store Connect](https://appstoreconnect.apple.com/apps), create a new macOS app with the name, bundle ID and SKU from the [submission copy](../store/safari/submission.md#app-information). Fill in App Information, Pricing and Availability, App Privacy and the age rating from the same file.
3. On the Mac you release from, sign in to Xcode under **Settings > Accounts** with an Apple account in the team.

## Release steps

1. Run the [manual check in real Safari](testing.md#checking-real-safari-by-hand) on the commit you are releasing.
2. On that main commit, run `npm run release:safari -w agent-browser-bridge-extension -- --team EV27867DV2`.
3. Wait for App Store Connect to finish processing the build, which shows under TestFlight. Optionally install it through TestFlight on a Mac and check it once more.
4. If the release changes what the extension looks like or does, run `npm run screenshots:safari` and upload the new screenshots; see [Screenshots](../store/safari/submission.md#screenshots).
5. In App Store Connect, add a macOS version with the same version number as `packages/extension/package.json`, choose the build, add the screenshots and What's New text, and check the rest against the [submission copy](../store/safari/submission.md).
6. Submit for review. Choose manual release if the Chrome and Safari releases should go out together.
7. Once the app is live, update the Safari install steps in the [README](../README.md#safari) to link to it.

The Mac App Store updates the app, and with it the extension, by itself.

# Mac App Store releases

Safari only loads extensions that come inside a signed Mac app, so the Safari extension ships as the Agent Browser Bridge app on the Mac App Store. Copy-ready App Store Connect fields and reviewer instructions live in [store/safari/submission.md](../store/safari/submission.md).

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

`npm run release:safari -w agent-browser-bridge-extension -- --build-number <n>` (`packages/extension/scripts/release-safari.mjs`) generates the project, archives a Release build signed ad hoc, and exports it with `xcodebuild -exportArchive`. The export signs the app with Apple's cloud-managed distribution certificate through the App Store Connect API key, creates the provisioning profiles it needs, and uploads the build. No certificate or profile has to be stored as a secret. Add `--no-upload` to write the signed package to `packages/extension/safari-release/` instead.

## One-time setup

1. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list), register the App ID `dev.agentbrowserbridge.app`. The export registers the extension's `dev.agentbrowserbridge.app.Extension` itself.
2. In [App Store Connect](https://appstoreconnect.apple.com/apps), create a new macOS app with the name, bundle ID and SKU from the [submission copy](../store/safari/submission.md#app-information). Fill in App Information, Pricing and Availability, App Privacy and the age rating from the same file.
3. Under Users and Access > Integrations > App Store Connect API, create a team key with the **Admin** role. Cloud-managed distribution certificates need it. Download the `.p8` file; Apple offers it only once.
4. Add these repository secrets on GitHub:

   | Secret | Value |
   | --- | --- |
   | `APPLE_TEAM_ID` | The team ID shown under Membership details in the developer account |
   | `APP_STORE_CONNECT_KEY_ID` | The key's ID |
   | `APP_STORE_CONNECT_ISSUER_ID` | The issuer ID shown above the key list |
   | `APP_STORE_CONNECT_KEY` | The whole contents of the `.p8` file |

To release from a Mac instead of GitHub, set the same names as environment variables, with `APP_STORE_CONNECT_KEY_PATH` pointing at the `.p8` file instead of `APP_STORE_CONNECT_KEY`.

## Release steps

1. Run the [manual check in real Safari](testing.md#checking-real-safari-by-hand) on the commit you are releasing.
2. Run the **Publish Safari App** workflow on that main commit. It runs the checks, builds with the release analytics keys, and uploads the build. Its build number is the workflow's run number, so it always increases.
3. Wait for App Store Connect to finish processing the build, which shows under TestFlight. Optionally install it through TestFlight on a Mac and check it once more.
4. In App Store Connect, add a macOS version with the same version number as `packages/extension/package.json`, choose the build, add the screenshots and What's New text, and check the rest against the [submission copy](../store/safari/submission.md).
5. Submit for review. Choose manual release if the Chrome and Safari releases should go out together.
6. Once the app is live, update the Safari install steps in the [README](../README.md#safari) to link to it.

The Mac App Store updates the app, and with it the extension, by itself.

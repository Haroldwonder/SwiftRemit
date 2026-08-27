# SwiftRemit Mobile — Release Process

This document covers how to ship a build to Apple TestFlight and Google Play internal testing from the `mobile/` workspace. It is the source of truth referenced by SR-096.

---

## Local Development

Before releasing, set up your local development environment to test changes on simulators or physical devices.

### Quick Start

```bash
cd mobile
npm install
cp .env.example .env
npx expo start
```

### Running on Simulators

**iOS Simulator (macOS):**
```bash
npx expo start
i
```

Requires Xcode 14+ with iOS 14.4+ simulator.

**Android Emulator:**
```bash
npx expo start
a
```

Requires Android Studio with API 21+ emulator configured.

### Running on Physical Devices

1. Install the **Expo Go** app from the App Store (iOS) or Google Play (Android)
2. Start the development server: `npx expo start`
3. Scan the QR code with your device camera (iOS) or the Expo Go app (Android)

### Environment Configuration

Edit `mobile/.env` to customize the API base URL and other settings:

```env
# API endpoint for the mobile app
REACT_APP_API_URL=http://localhost:3000

# EAS project ID (from Expo dashboard)
EAS_PROJECT_ID=your_project_id_here
```

See [CONFIGURATION.md](../CONFIGURATION.md) for the full list of available variables.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | `nvm use 20` |
| EAS CLI | latest | `npm i -g eas-cli` |
| Expo account | — | <https://expo.dev> |
| Apple Developer account | — | <https://developer.apple.com> |
| Google Play Console account | — | <https://play.google.com/console> |

### One-time secrets (set in repository Settings → Secrets)

| Secret | Description |
|--------|-------------|
| `EXPO_TOKEN` | Expo access token — `eas account:generate-access-token` |
| `APPLE_ID` | Apple ID email used to submit to App Store Connect |
| `ASC_APP_ID` | App Store Connect app ID (numeric, from the app URL) |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

---

## Version bump

Before cutting a release:

1. Increment `version` in `mobile/app.json` (semver).
2. `autoIncrement: true` in `eas.json` handles the build number automatically for production builds.

```bash
# Example: bump minor version
sed -i 's/"version": "1.0.0"/"version": "1.1.0"/' app.json
```

---

## Build profiles

`eas.json` defines three profiles:

| Profile | Purpose | Output |
|---------|---------|--------|
| `development` | Local dev client on simulator | simulator build |
| `preview` | Internal QA distribution (no store) | `.ipa` (sim) / `.apk` |
| `production` | Store release | `.ipa` / `.aab` |

---

## Shipping to TestFlight

### Step 1 — Build the production iOS binary

```bash
cd mobile
npx eas-cli build --platform ios --profile production --non-interactive
```

EAS builds the `.ipa` on Expo's managed macOS fleet and uploads it to App Store Connect automatically via the `submit.production.ios` config in `eas.json`.

### Step 2 — Verify the build in App Store Connect

1. Log in to <https://appstoreconnect.apple.com>.
2. Navigate to **My Apps → SwiftRemit → TestFlight**.
3. The build appears under **iOS Builds** once Apple's processing finishes (≈ 5–10 min).

### Step 3 — Add testers

- **Internal testing** (up to 100 App Store Connect users): available immediately after processing.
- **External testing** (up to 10 000 users): requires a Beta App Review — submit via the TestFlight tab.

### Step 4 — Notify testers

TestFlight sends automatic install emails.  For a manual nudge, use the "Notify Testers" button in App Store Connect.

### Step 5 — Promote to production

When the build is stable, click **Submit for App Review** in App Store Connect.

---

## Shipping to Play Internal Testing

### Step 1 — Create a Google Play service account

1. In [Google Play Console](https://play.google.com/console), open **Setup → API access**.
2. Link a Google Cloud project and create a service account with the **Release manager** role.
3. Download the JSON key to `mobile/google-play-service-account.json` (do **not** commit this file — it is in `.gitignore`).

### Step 2 — Build the production Android bundle

```bash
cd mobile
npx eas-cli build --platform android --profile production --non-interactive
```

EAS builds a signed `.aab` (App Bundle) using credentials stored in your Expo account keystore.

### Step 3 — Submit to the Play Internal testing track

```bash
npx eas-cli submit --platform android --profile production --non-interactive
```

`eas.json` is configured with `"track": "internal"`, so the bundle lands in the **Internal testing** track automatically.

### Step 4 — Add testers in Play Console

1. Open **Testing → Internal testing** in Play Console.
2. Click **Testers** and add email addresses or a Google Group.
3. Testers receive an opt-in link to install the build.

### Step 5 — Promote to Alpha / Beta / Production

In Play Console, click **Promote release** to graduate the build through the tracks.

---

## CI-driven release (recommended workflow)

The `mobile-ci.yml` workflow builds a `preview` profile on every push to `main` via EAS. For a production release:

1. Create and push a release tag: `git tag mobile-v1.1.0 && git push --tags`
2. Manually trigger the workflow with the `production` profile, or add a separate `release.yml` job that detects the `mobile-v*` tag pattern and runs:

```yaml
- name: EAS Submit iOS
  run: eas submit --platform ios --profile production --non-interactive
  env:
    EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}

- name: EAS Submit Android
  run: eas submit --platform android --profile production --non-interactive
  env:
    EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
```

---

## Rollback

| Platform | Method |
|----------|--------|
| iOS | In App Store Connect → TestFlight, stop the previous build from being distributed, or file an expedited review to re-publish an older version. |
| Android | In Play Console, halt the current release and re-activate a previous release in the same track. |

---

## Environment variables (runtime)

Push notification delivery and the API base URL are configured via `app.json` → `extra`:

```json
{
  "expo": {
    "extra": {
      "apiUrl": "https://api.swiftremit.io",
      "eas": {
        "projectId": "YOUR_EAS_PROJECT_ID"
      }
    }
  }
}
```

For environment-specific builds, use [EAS environment variables](https://docs.expo.dev/eas/environment-variables/) so secrets are never committed to the repo.

---

## Checklist before every release

- [ ] `version` bumped in `app.json`
- [ ] All CI jobs green on the release branch (`lint`, `typecheck`, `test`)
- [ ] Smoke-tested on a physical device (iOS + Android)
- [ ] Push notifications verified (token registers, tapping routes to correct screen)
- [ ] No amounts or PII visible on lock-screen previews
- [ ] `CHANGELOG.md` updated
- [ ] Release notes drafted in App Store Connect / Play Console

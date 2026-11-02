# Releasing and hosting

The public download page is [gettrace.pages.dev](https://gettrace.pages.dev/). The current package is an unsigned Windows 10/11 x64 beta. All current features are free, without accounts, billing or activity uploads.

## Windows package

Build on a configured Windows MSVC machine:

```text
npm ci
npm run installer
```

Tauri creates the NSIS setup in `target/release/bundle/nsis/`, bundles the collector and embeds Microsoft's WebView2 bootstrapper. Setup installs for the current Windows account; fetching a missing WebView2 Runtime needs internet. Updates and uninstall retain the local activity database. Users can export or delete recorded activity in Settings before uninstalling.

`.github/workflows/windows-release.yml` builds a clean Windows package for `v*` tags. It runs source tests, creates the setup and SHA-256 checksum, checks the installer lifecycle and prepares a draft prerelease. Tagging does not merge any branch. Keep build outputs in release assets, not in Git source.

The CI-only `scripts/verify-installer.mjs` installs into a disposable runner, checks opt-in defaults, confirms both native windows and collector startup, tests a running upgrade and verifies history recovery after uninstall/reinstall. It refuses to run as a local installation test. `.github/workflows/installer-qa.yml` separately checks the published beta download against its pinned checksum.

Before publishing a new version:

1. Update version metadata and release notes.
2. Build from the intended source commit and complete automated checks.
3. Verify the exact setup, checksum and installation behavior.
4. Complete the applicable [hardware acceptance checks](validation.md).
5. Publish the verified release and update the download website.

Never silently replace a verified release asset. A new binary needs a new release tag and checksum. Trusted signing of the installer, host and collector is required before general availability. The current beta's unsigned status is disclosed on the download page and release notes.

## Cloudflare Pages

| Setting                 | Value                         |
| ----------------------- | ----------------------------- |
| Project                 | `gettrace`                    |
| Public URL              | `https://gettrace.pages.dev/` |
| Production branch label | `feat/trace-bar-hover-focus`  |
| Source                  | `website/`                    |
| Prepared assets         | `dist/cloudflare-pages/`      |

The site uses static assets, with no Pages Functions or central activity database. This avoids a custom application/download server. Monitor hosting limits and availability as usage grows; a free plan is not an unlimited service guarantee.

Prepare and publish using the authorized Cloudflare account:

```text
npm run site:build
npx wrangler@4.92.0 pages deploy dist/cloudflare-pages --project-name gettrace --branch feat/trace-bar-hover-focus
```

The packager checks the pinned installer SHA-256 before writing deployment files. It uses an existing local beta package when available; otherwise it downloads the published copy. An explicit installer path can be supplied with `npm run site:build -- path/to/setup.exe`. For a new binary, update the packager's pinned checksum and installer QA together. The prepared folder can also be uploaded through Cloudflare's Pages dashboard.

After deployment, verify the primary URL, website assets, canonical metadata, sitemap, custom HTTP 404 and one-click installer download. Hash the downloaded file and compare it with the release checksum. Update the repository homepage and release notes if the public address changes.

The earlier Sites deployment is a fallback, not the primary public URL. Its local checkout remains ignored; current website metadata and documentation use Cloudflare Pages. Historical deployment identifiers and the original launch audit are retained in [the archive](archive/launch-audit.md).

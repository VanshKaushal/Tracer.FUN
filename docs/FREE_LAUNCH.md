# Free launch readiness

Trace's current release is entirely free: no billing, accounts, trials or mandatory analytics. The native product currently supports Windows 10/11 x64. A responsive website does not make global tracking available on phones, macOS or Linux.

## Visitor and installation experience

The public download page lives at https://trace-free-desktop.deekaushal16.chatgpt.site/. Its source is in `website/`. The separate Sites checkout is `.launch-site/`, with its identity in `.openai/hosting.json`; do not recreate the Site. Project ID: `appgprj_6ae4c87bf27c81918db0832c28c21b7b`.

The intended path is **Download setup → double-click → finish → open Trace → choose tracking consent**. Node, Rust, Git and terminal commands are developer requirements only. The installer bundles the collector, installs for the current Windows account, creates a Start menu entry and bootstraps WebView2 when absent. Downloading that runtime needs internet. Both views share one collector; no separate service setup is needed.

Uninstalling preserves `%LOCALAPPDATA%\Trace` so reinstalling can recover history. To remove recorded history, use Settings to delete it before uninstalling; exporting first is optional. Collection is opt-in, startup is opt-in, and closing a view does not stop collection. The system tray provides pause/quit controls. Trace itself does not encrypt its database or back it up to a server.

## Screenshot checklist audit

| Item | Result and relevance |
| --- | --- |
| Remove horizontal scrolling | Addressed: populated dashboard routes at 320/430/768 px; tables scroll inside their panels. Download page checked at 320/430/768/1440 px. High importance. |
| Find broken links | App routes and recovery tested; landing page anchors and assets checked. Release/download URLs must be checked after publishing every release. High importance. |
| Mobile menu | Dashboard drawer with labels, focus handling and Escape. Download page has a native disclosure menu with focus restoration. High importance for the website. |
| Favicon | Shared lightweight SVG on both app entries and download page. Small but useful polish. |
| Page titles | Route-specific dashboard titles, download and recovery-page titles. Useful for navigation and discovery. |
| Meta descriptions | Dashboard, bar and public download page metadata. Most important on the public website. |
| Footer links | Download page privacy, support and source links. No invented contact details. Useful for trust. |
| Custom 404 | Dashboard recovery view; website includes `404.html`. Hosting's HTTP status behavior must also be verified. Useful for recovery. |
| Copyright year | Download page uses the current browser year, with a static fallback. Low importance. |
| Compress images | Logo is SVG; the product illustration is HTML/SVG, with no large photos or external font downloads. Useful for fast loading. |
| Broken buttons | Existing browser regressions exercise controls, settings, consent, pause, export and bar behavior; real installer lifecycle is a separate gate below. High importance. |
| Success messages | Existing live status notifications for saved preferences, export and deletion. Useful action feedback. |
| Error messages | Reconnect and storage feedback; missing collector and Application Control errors now have plain-language recovery guidance. High importance. |
| Placeholder text | No lorem ipsum or fake reviews. Website illustration explicitly identifies sample data. Important for honest presentation. |
| Unused navigation | Current dashboard routes correspond to implemented views. Website links lead to sections, release information or support. Useful. |
| Mobile overflow | Long names, metric values and filters contained; onboarding dialogs scroll on short windows. High importance. |
| Clickable logo | Dashboard opens Overview; website returns home. Useful convention. |
| Clickable phone number | Not applicable: the product doesn't publish a support phone number. Do not invent one. |
| Clickable email | Not applicable: no product support email is configured; GitHub issues provide support. Add `mailto:` if a real address is published later. |
| Every page mobile optimized | Dashboard route coverage plus the responsive website. Native mobile tracking is not claimed. High importance for discovery. |

## Release process

`.github/workflows/windows-release.yml` builds on a clean Windows runner when a `v*` tag is pushed. It runs frontend, bridge, browser and Rust tests, creates the NSIS setup and SHA-256 checksum, uploads artifacts and prepares a **draft prerelease**. This keeps unverified builds from becoming public downloads automatically. The current release source remains on `feat/trace-bar-hover-focus`; tagging does not merge `main`.

Before publishing a draft, download the exact asset and verify its checksum, package contents and installation behavior. Future tagged builds also run the installer lifecycle check before uploading artifacts. Keep the release and download page tied to the same immutable tag and checksum. Never silently replace an asset after verification. A future version should get its own tag and release. The initial beta's setup is served directly from the static site, with a GitHub release mirror; a clean Windows runner has verified that public download, installation, both windows, running upgrade, uninstall and history recovery. See `validation.md` for the exact run and remaining hardware gates.

## Remaining general-availability gates

- Sign the installer, application and collector with a trusted Windows publisher identity. No signing credential is configured. Unsigned beta warnings and Application Control blocks are disclosed; users should not disable security to install Trace.
- Verify install, launch, upgrade with both processes running, uninstall and reinstall on clean Windows 10/11 accounts, including a machine without WebView2.
- Complete the physical multi-monitor/DPI, sleep/resume, fullscreen and sustained CPU/memory/disk checks in `validation.md`. Automated simulations are not substitutes for these measurements.
- Confirm the published installer asset and checksum are anonymously downloadable. The initial preview is a beta, not a production-certified release.

The app stores activity locally, so a large number of installations does not create a central activity database or telemetry ingestion service. The static website serves the installer directly, with GitHub Releases as a mirror, avoiding a custom download server. This does not establish an unlimited traffic guarantee; monitor hosting quotas, download availability and support reports. Introduce analytics only with a separate privacy decision, not as a hidden part of the free launch.

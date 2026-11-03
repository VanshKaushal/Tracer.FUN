// Public guide content is rendered into static HTML by the website packager.
export const guides = [
  {
    slug: "install-trace",
    title: "How to install Trace on Windows",
    description:
      "Install the free Trace Windows beta, enable tracking and open Trace Bar. Includes system requirements, blocked-installer help and uninstall guidance.",
    summary:
      "Trace uses a normal Windows installer. Download the setup, follow its screens and choose whether to enable tracking on first launch. No developer tools, account or command line are required.",
    body: `
      <h2>Which PCs can run Trace?</h2>
      <p>The current release, Trace 0.1.0-beta.1, supports Windows 10 and Windows 11 on Intel and AMD x64 PCs. Native macOS, Linux, ARM64 and mobile tracking are not available in this beta. All current features are free.</p>
      <h2>Download and install</h2>
      <ol>
        <li>Open the <a href="/#download">official Trace download section</a> and choose <strong>Download free Windows beta</strong>.</li>
        <li>Open <strong>Trace-Windows-x64-Setup.exe</strong> from your Downloads folder and follow the setup screens.</li>
        <li>Launch Trace from the finish screen or the Windows Start menu. If Microsoft WebView2 is missing, setup needs internet access to fetch that runtime.</li>
        <li>Choose whether to enable activity tracking. Review the dashboard, then use its <strong>Trace Bar</strong> button to open the compact desktop view. Configure the bar's position and hover details in Settings.</li>
      </ol>
      <aside class="notice" aria-label="Unsigned beta information"><p><strong>This beta is unsigned.</strong> Windows may show an unknown-publisher warning, and Application Control may block the installer or collector. Trusted publisher signing is still pending. Do not disable device security to install Trace. On a managed PC, ask your administrator whether the app is permitted.</p></aside>
      <h2>What if the collector is blocked or disconnected?</h2>
      <p>The collector supplies activity to both the dashboard and Trace Bar. If Windows reports an Application Control block, clicking Reconnect cannot override that policy. If no policy block is shown, restart Trace and check whether the dashboard reconnects.</p>
      <p>If it still fails, <a href="https://github.com/VanshKaushal/Tracer.FUN/issues">report the exact error and your Windows version</a>. Do not upload your activity database or private exports to a public issue.</p>
      <h2>Starting, pausing and quitting</h2>
      <p>Starting with Windows is optional and off by default. You can pause tracking from the dashboard or Trace Bar. Closing the dashboard does not necessarily stop collection: use Trace's system tray menu to pause or quit.</p>
      <h2>Updates and uninstalling</h2>
      <p>Updates and uninstalling preserve your local history. To remove collected activity, export anything you want to keep and use <strong>Settings → Delete all collected data</strong> before uninstalling. Read <a href="/guides/heatmaps-and-privacy/">where Trace stores history</a> for retention and privacy details.</p>
      <p><a href="https://github.com/VanshKaushal/Tracer.FUN/releases/tag/v0.1.0-beta.1">Release notes and the GitHub download mirror</a> are available if you need the current beta's package information.</p>
    `,
  },
  {
    slug: "mouse-distance",
    title: "How to measure cursor distance on Windows",
    description:
      "Use Trace to measure cursor movement in pixels or eight estimated screen-distance units. Learn how to change units and why screen travel differs from desk travel.",
    summary:
      "Trace measures the distance your cursor travels across the screen. Pixels are the underlying measurement. Other units estimate screen distance using display DPI; they do not measure how far your mouse moves across your desk.",
    body: `
      <h2>Start measuring cursor movement</h2>
      <ol>
        <li><a href="/guides/install-trace/">Install the Windows beta</a> and enable tracking when you are ready.</li>
        <li>Move your cursor, then open the dashboard's Movement view. Choose a date range to review recorded activity.</li>
        <li>Use the <strong>Distance unit</strong> selector in the dashboard, or choose a preferred unit in <strong>Settings → Display &amp; retention</strong> and save your settings.</li>
        <li>For a compact view, open Trace Bar and choose cursor distance among its hover details in Settings.</li>
      </ol>
      <h2>Which distance units are available?</h2>
      <table class="guide-table"><caption>Nine display units supported by Trace</caption><thead><tr><th scope="col">Unit</th><th scope="col">Symbol</th><th scope="col">Meaning</th></tr></thead><tbody>
        <tr><th scope="row">Pixels</th><td>px</td><td>Recorded cursor travel</td></tr>
        <tr><th scope="row">Millimeters, centimeters, meters, kilometers</th><td>mm, cm, m, km</td><td>Estimated screen distance</td></tr>
        <tr><th scope="row">Inches, feet, yards, miles</th><td>in, ft, yd, mi</td><td>Estimated screen distance</td></tr>
      </tbody></table>
      <h2>Does changing units change my history?</h2>
      <p>No. Trace preserves raw pixel-distance totals and converts them for display. Choosing centimeters or miles changes how the recorded distance is shown; it does not rewrite the original pixel totals.</p>
      <h2>Why is physical distance an estimate?</h2>
      <p>The conversion uses the display DPI available to Trace. Windows scaling and different monitor densities affect that estimate, particularly across mixed-display setups. The converted number should not be treated as a calibrated ruler measurement.</p>
      <p>Mouse sensitivity, acceleration and hardware settings also mean that cursor travel and hand movement are different quantities. Use Trace to understand screen interaction, not to measure desk travel or make ergonomic or medical conclusions.</p>
      <h2>Why is the total not increasing?</h2>
      <p>Check that tracking is enabled, the collector is connected, and pause or incognito is not active. Confirm that the selected date range and monitor include the activity you want to see. For startup problems, see the <a href="/guides/install-trace/">installation and collector guide</a>.</p>
      <p>For the other charts and the records behind them, read <a href="/guides/heatmaps-and-privacy/">heatmaps, local history and privacy</a>.</p>
    `,
  },
  {
    slug: "heatmaps-and-privacy",
    title: "Trace heatmaps, local history and privacy",
    description:
      "Understand Trace's cursor and click heatmaps, local Windows database, retention settings, exports and deletion. No account or activity upload is required.",
    summary:
      "Trace builds heatmaps from activity counts in screen regions. It saves recorded history locally at %LOCALAPPDATA%\\Trace\\trace.db under your Windows account. Trace does not upload this activity or require a cloud account.",
    body: `
      <h2>What does a mouse heatmap show?</h2>
      <p>A heatmap groups recorded interactions into a grid over a monitor's screen area. In Trace's Heatmap view, choose the activity type, date range and monitor to explore where activity is concentrated. A frequently used screen region can stand out because of cursor activity or clicks; it does not identify what was on the screen.</p>
      <p>Trace does not take a screenshot behind the heatmap. The chart describes positions and interaction counts, rather than the text, documents or websites displayed there.</p>
      <h2>Where is my Trace history stored?</h2>
      <p>Trace stores history in a local SQLite database at <code>%LOCALAPPDATA%\\Trace\\trace.db</code>. You can paste <code>%LOCALAPPDATA%\\Trace</code> into File Explorer's address bar to find the folder. A running database may also have companion <code>-wal</code> and <code>-shm</code> files.</p>
      <p>Trace does not encrypt this database itself. Protect your Windows account and device, and treat exports as private files. No central Trace account, activity upload or cross-device synchronization is required or provided by the current beta.</p>
      <h2>What does Trace record?</h2>
      <p>Recorded activity includes cursor-distance totals, click and scroll counts, activity and idle summaries, heatmap cells and focus-session summaries. Raw movement events are not stored. Trace does not capture typed text, screenshots, clipboard contents or browsing URLs.</p>
      <h2>How long is history kept?</h2>
      <table class="guide-table"><caption>Current default retention settings</caption><thead><tr><th scope="col">Record</th><th scope="col">Default retention</th></tr></thead><tbody>
        <tr><th scope="row">Raw clicks and drags</th><td>24 hours; configurable from 1 to 24 hours</td></tr>
        <tr><th scope="row">Detailed minute data</th><td>30 days; configurable from 7 to 30 days</td></tr>
        <tr><th scope="row">Hourly, daily and heatmap aggregates; focus history</th><td>Until you delete collected data</td></tr>
      </tbody></table>
      <p>Adjust the detailed-data retention periods in <strong>Settings → Display &amp; retention</strong>. Shortening raw retention does not automatically erase the longer-lived aggregate summaries.</p>
      <h2>How can I stop recording or remove history?</h2>
      <p>Pause tracking or enable incognito when you want activity to be excluded. These controls do not delete earlier history. To remove recorded activity, export anything you want to keep and use <strong>Settings → Delete all collected data</strong>. Exported copies are separate files; manage or delete those yourself.</p>
      <p>Updates and uninstalling preserve the database so a reinstall can recover it. Use the deletion control before uninstalling if you want collected history removed. See the <a href="/guides/install-trace/">installation guide</a> for the current beta's setup and security limitations.</p>
    `,
  },
];

# Privacy policy

Last updated: 2026-10-03

This policy describes the current browser-extension source of X-Posed: Account Location & Device Info. Versions available in browser stores may not include every feature described below. The separate iPhone and iPad app has its own [privacy policy](PRIVACY_iOS.md).

## In brief

- X-Posed reads account information and post elements on X to display labels and apply your filters locally. It does not block or mute accounts through X.
- Community Cache is enabled by default on new installations. Updates preserve your existing choice. You can turn it off in Settings.
- Community lookups send the requested public account handles to the cache server. Contributions share a limited set of account metadata. Handles and account IDs are identifiable data, not anonymous records.
- X authentication headers are stored locally and used only for requests to X. They are not sent to Community Cache.
- Filter rules and filtering statistics stay local unless you choose to export rules in a backup. There is no usage-analytics or advertising code in the extension.

## Information read from X

The extension reads usernames, account labels, post links and relevant page elements on `x.com` and `twitter.com`. It can request additional account information from X using your existing signed-in session. This includes X's account country or region, connection source, location-accuracy warning, affiliation, account dates and other profile metadata shown in the account-details card.

These are X's account-level labels, not a measurement of someone's current physical location or the device used for an individual post. A location warning is not proof that someone uses a VPN. Information from X or the community cache can be incomplete, stale or inaccurate.

To make authenticated requests, the extension captures authorization and CSRF headers from X's requests and saves them in extension-local storage. It can also read X's `ct0` CSRF cookie from the X page context; the browser supplies applicable session cookies when making authenticated requests to X. X-Posed does not ask for or record your password. The saved headers are sensitive session-related data and are not included in configuration exports or community-cache requests.

## Local settings, account cache and profile details

Settings, saved filters, Always Show accounts and the account cache are stored in the browser's extension-local storage, not browser sync storage. Saved filters can contain text, handles, domains or URLs you enter.

The account cache is keyed by handle. New cache writes retain a compact record of location, connection source, location accuracy, affiliation and freshness information. Older stored records can contain additional metadata. The cache has a configured limit of 50,000 accounts and treats observations older than 60 days as expired; entries can be evicted sooner because of capacity or browser-storage limits. Expired entries are removed during cache loading, access or saving, rather than by a server-side deletion schedule.

**Use profile details**, in **Blocking → Behavior**, is enabled by default. It reads a bounded subset of profile data already delivered in X's own responses: bios, self-written profile locations, website and bio links, account labels, and follower, following, post and media counts. This passive feature makes no additional requests to X. It holds up to 500 profiles in page-session memory, with limits on text and link sizes. This profile cache is not written to disk, exported or contributed to Community Cache. Turning the feature off clears it; it also clears when the page session ends. Your saved matching rules remain until you change or remove them.

**Always show accounts I follow**, in **Blocking → Always Show**, is off by default and works independently of **Use profile details**. When enabled, it reads follow status already supplied by X to exempt confirmed followed accounts from your filters, without extra requests. A numeric signed-in account ID, or the visible handle when unavailable, is used only in memory to keep signed-in accounts separate. These viewer-specific relationships stay in page-session memory, are cleared when the signed-in account changes or the option is disabled, and are never written to disk, exported or shared with Community Cache. Only the on/off preference is saved and included in backups.

**Hide replies and quotes of filtered posts**, in **Blocking → Behavior**, is off by default. When enabled, it reads post IDs, author handles, languages and exact reply/quote relationships already delivered by X, plus bounded display names and account labels from visible headers. Up to 5,000 public post observations stay in page-session memory, with no post text retained and no extra requests. They are not written to disk or shared with Community Cache, and are cleared when the option is disabled, the signed-in account changes or the page session ends. This hides related posts locally; it does not add their authors to your filters or block them on X.

## Community Cache

When enabled, the extension contacts `https://x-posed-cache.xaitax.workers.dev`, hosted on Cloudflare Workers with Workers KV storage. It sends handles for account lookups and can contribute freshly obtained account information to help other users avoid repeated X requests. The server also provides aggregate cache totals.

Contributed records can contain:

| Field | Purpose |
|---|---|
| Public handle | Identifies the account being cached |
| Country or region | X's account-location label |
| Connection source | X's device, platform or app-store label |
| Location accuracy | Whether X reports a location warning |
| Affiliation | Organization name or handle, when available |
| Account creation date | Account age information, when available |
| Numeric account ID | X's account identifier, when available |
| Handle-change count | Number reported by X, when available |
| Cache timestamp | Time recorded by the server when storing the entry |

Community contributions do not include passwords, X authorization or CSRF headers, X session cookies, post text, profile images, bios, follower/following counts, your follow relationships, filter rules or filtering-statistics records. Lookup requests nevertheless reveal which handles are being requested. The service is not an anonymous lookup system.

Requests use HTTPS. Cloudflare receives network information, including the requesting IP address, and the worker uses that address for rate limiting. This policy does not promise that infrastructure providers keep no request logs or network metadata.

Cloud records are configured to expire 60 days after a write. A later contribution can refresh a record. Turning off Community Cache stops new cloud lookups and contributions; requests already in progress may finish. It does not delete existing community records or prevent other users from contributing the same accounts. Clearing your local cache or uninstalling the extension does not delete community records either.

## Local filtering statistics

Filtering statistics count unique, identifiable posts hidden or highlighted by your filters. Location and device breakdowns use information already available to the extension, without extra X or community-cache requests.

The extension stores totals and per-post fingerprints in local IndexedDB. Each fingerprint is a SHA-256 hash of the post ID and a reset-specific identifier. The statistics database stores those fingerprints and coarse location/device buckets, not raw post IDs, post text or account handles. The fingerprints prevent repeated counting across tabs and restarts. They are pseudonymous identifiers, not a guarantee of anonymity.

These records are not uploaded or included in configuration exports. They remain until you use **Statistics → Filtering → Reset counts** or remove the extension's data through the browser. Resetting clears totals and fingerprints without changing your filters or account cache. Clearing the account cache does not reset statistics. The world maps are bundled and do not contact a map service.

## Sharing, backups and external resources

The Share feature creates an image locally from the selected post and its displayed account information. Rendering can load the account's profile image and post media from their existing image URLs. You choose whether to copy the result to your clipboard, download a PNG, open an X draft, or send it through your device's share menu. Opening an X draft sends the selected draft text and post link to X. Native sharing passes the selected content to the service you choose. X-Posed does not publish posts automatically or upload these images to Community Cache.

**Export Data** creates a local file containing settings, filter rules, saved Always Show accounts and cached account information. It excludes saved authentication headers, observed follow and post relationships, the passive profile cache and filtering statistics. Backups and saved images can contain account information and personal filtering preferences; review them before sharing. Removing extension data does not remove files you already downloaded.

Country flags can load from X's Twemoji CDN at `abs-0.twimg.com`; profile and media images can load from X's image hosts. Those providers receive the associated network requests even when Community Cache is off. Interface icons and world maps are bundled with the extension. The extension does not execute downloaded code.

Support, donation, repository, browser-store and app links open external services when you follow them. Their policies apply to those visits and any transactions. No external donation widget is embedded in the settings page.

## Permissions and controls

| Permission | Use |
|---|---|
| `storage` | Save settings, filters, cached accounts and request headers locally |
| `*://*.x.com/*` and `*://*.twitter.com/*` | Read relevant page information, add the interface and make requests to X |
| `https://x-posed-cache.xaitax.workers.dev/*` | Make community-cache requests when enabled |

The Firefox manifest also declares `websiteActivity` under its data-collection permissions. The extension does not request the browser's `cookies` permission; this does not mean it cannot use X's existing session as described above.

You can disable Community Cache in Settings, disable passive profile details in Blocking → Behavior, clear cached accounts from the popup or Settings, reset filtering statistics separately, and remove individual rules or Always Show entries. **Clear cache** does not clear saved authentication headers, settings, filters or statistics. Use your browser's extension-data controls or remove the extension to remove its locally stored data; separately delete any exported files you no longer need.

## Contact

For questions about this policy, contact Alexander Hagenah through [@xaitax on X](https://x.com/xaitax) or [primepage.de](https://primepage.de).

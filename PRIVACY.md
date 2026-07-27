## **Privacy Policy for "X-Posed: Account Location & Device Info"**

**Last updated: 2025-11-27**

This browser extension prioritizes your privacy. By default, it does **not** collect, transmit, store, or share any personal data.

---

### **What the extension does**

* Reads publicly visible usernames on *x.com* / *twitter.com*.
* Makes authenticated requests **only** to X's official GraphQL API using the user's existing session to display:
  * Account country label
  * Device/platform indicator
* Caches this data **locally** in the user's browser (`chrome.storage.local`) to avoid repeated API calls.

---

### **What the extension does *not* do**

* It does **not** collect any personal information.
* It does **not** use analytics, tracking scripts, or third-party services.
* It does **not** include or execute remote code.
* It does **not** access or read cookies outside X's own context.
* It does **not** store or transmit user credentials.

---

### **Community Cloud Cache (Opt-In Feature)**

The extension includes an **optional** Community Cloud Cache feature that is **disabled by default**. When enabled by the user:

#### **What data is shared**

Only anonymous, non-personal data is transmitted:

Every field below is already public on the account's own X profile.

| Field | Description | Example |
|-------|-------------|---------|
| Username | Public X handle | `@xaitax` |
| Location | Country from X's API | `United States` |
| Device | Platform type | `Android`, `iOS`, `Web` |
| Affiliation | Parent organisation shown on the account's badge, when it has one | the organisation's public name |
| Account created | Account creation date | Unix timestamp |
| Account ID | X's numeric account ID | `44196397` |
| Handle changes | How many times the username has changed | `0` |
| Timestamp | When data was cached | Unix timestamp |

#### **What is NOT shared**

* No real names
* No email addresses
* No IP addresses (requests go through Cloudflare Workers)
* No profile pictures or bios
* No tweet content
* No follower/following counts
* No personal identifiers

#### **How it works**

1. **Lookup**: Extension queries the cloud cache for username → location/device mapping
2. **Miss**: If not found, queries X's API directly
3. **Contribute**: After fetching from X, contributes the anonymous mapping to the cloud

#### **Data retention**

* Cloud cache entries expire after **60 days**
* Data can be deleted by the cloud server operator at any time
* Users can disable cloud cache at any time in the Options page

#### **Self-hosting**

Users can deploy their own Cloudflare Worker to run a private cloud cache server. See the [cloud-server documentation](cloud-server/README.md) for instructions.

---

### **Data Storage**

#### **Local Storage (Default)**

All cached data is stored **locally on the user's device** using `chrome.storage.local` and never leaves the browser unless the user explicitly enables Community Cloud Cache.

Users may clear the cache at any time via:
* Extension popup → "Clear Cache" button
* Browser settings → Extension data

#### **Cloud Storage (Opt-In Only)**

When Community Cloud Cache is enabled:
* Anonymous username mappings are stored on Cloudflare Workers KV
* Data is encrypted in transit (HTTPS)
* No personal data is ever transmitted

---

### **Permissions**

The extension requests the minimum required permissions:

| Permission | Purpose |
|------------|---------|
| `storage` | Store cache and settings locally |
| `*://*.x.com/*` | Read page content and make API requests to X |
| `*://*.twitter.com/*` | Legacy domain support |

No additional permissions are required for the optional cloud cache feature.

---

### **Third-Party Services**

#### **Default Mode (Cloud Cache Disabled)**
* **No third-party services used**
* All requests go directly to X's servers

#### **With Cloud Cache Enabled**
* **Cloudflare Workers**: Hosts the community cache server
* Cloudflare's privacy policy applies to their infrastructure
* No personal data is transmitted or stored

---

### **User Control**

Users have full control over their data:

| Action | How |
|--------|-----|
| Disable extension | Toggle in popup or browser settings |
| Clear local cache | Popup → "Clear Cache" button |
| Disable cloud cache | Options → Toggle "Community Cloud Cache" off |
| Remove extension | Browser → Manage extensions → Remove |

---

### **Changes to This Policy**

Any material changes to this privacy policy will be noted in the extension changelog and this document's "Last updated" date.

---

### **Contact**

For questions or concerns, please contact:

**Alexander Hagenah**
* X: [@xaitax](https://x.com/xaitax)
* LinkedIn: [alexhagenah](https://www.linkedin.com/in/alexhagenah/)
* Website: [primepage.de](https://primepage.de)
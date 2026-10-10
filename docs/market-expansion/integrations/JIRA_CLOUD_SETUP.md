# Connecting Jira Cloud to Growth OS — setup guide for IT administrators

Growth OS (Market Expansion OS) creates the tasks of an **approved** validation or pilot plan as issues
in your Jira Cloud projects. It connects through **OAuth 2.0 (3LO)** as a **dedicated integration
account** that you create, with the smallest set of scopes and project permissions that works. This
guide covers the app registration, the integration account, the exact scopes and permissions, the
redirect URL, and how to rotate and revoke. Decision record: D-121 (policy), D-135 (contract).

Only **Jira Cloud** is supported. Jira Data Center is not supported in the pilot.

---

## 1. What Growth OS does in Jira — and what it never does

| Growth OS does | Growth OS never does |
|---|---|
| Creates one issue per approved task in the **mapped projects** only (summary, description with the case, gate and snapshot, assignee, due date, labels) | Edits, transitions, comments on or deletes issues |
| Writes one issue **entity property** `growth-os.idempotency` and one label `growth-os-key-<64 hex>` on each issue it creates, so a retry after a network failure finds the issue instead of creating a duplicate | Reads issues outside the mapped projects |
| Reads project details, issue types, its own permissions and **assignable users** of the mapped projects (to check the task mapping before sending) | Sends anything to prospects or customers |
| Searches the mapped projects for its own key label (reconciliation) | Decides anything: sending tasks requires an approved gate in Growth OS; Jira permissions never approve |
| Keeps the issue key, URL and status only | Stores issue content beyond what it created |

Every issue shows the integration account as reporter. The description names the case, the approving
gate and snapshot (for example "ME-104 · approved under G2 · Snapshot v3") and who requested the send.

---

## 2. Create the integration account

1. Create a dedicated Atlassian account, for example **Growth OS integration**
   (`growth-os-integration@<your-domain>`). Do not use a person's account: tokens tied to a person
   break when that person leaves, and their permissions are broader than needed.
2. Give it **Jira** product access on your site.
3. In each **mapped project** (the projects you will use for validation and pilot tasks, for example
   `PIL` and `ME-VAL`) — and **only** there — grant, through the project's permission scheme (a
   project role or group is easiest):

   | Project permission | Why |
   |---|---|
   | **Browse projects** | read project details, issue types, assignable users; search for its own key label |
   | **Create issues** | create the task issues (the key property and label are written in the same request) |
   | **Assign issues** | set the assignee from the Growth OS task mapping |

   Do **not** grant Edit, Transition, Delete, Administer or any global admin permission. Growth OS
   never needs them.
4. The people Growth OS assigns tasks to need **Assignable user** in the mapped project (your normal
   Jira setup). The S14 "Check with Jira" lookup shows anyone who is not assignable.
5. Optional: the global permission **Browse users and groups** lets the mapping check tell "not found
   in Jira" apart from "not a member of the project". Without it both read "not a member of project".

---

## 3. Register the OAuth 2.0 (3LO) app

In the Atlassian developer console (<https://developer.atlassian.com/console/myapps/>), signed in as
an administrator of your organisation:

1. **Create → OAuth 2.0 integration.** Name: `Growth OS`.
2. **Permissions → Jira API → Configure.** Add exactly these classic scopes:

   | Scope | Used for |
   |---|---|
   | `read:jira-work` | projects, issue types, permissions, search, reading the key property |
   | `write:jira-work` | creating issues with the key property and label |
   | `read:jira-user` | assignable-user lookups for the task mapping |

   Growth OS also requests **`offline_access`** at authorization time so it receives a refresh token
   and does not need a person to log in again every hour. Nothing else is requested; Growth OS refuses
   an authorization that is missing any of the four.
3. **Authorization → OAuth 2.0 (3LO) → Callback URL.** Enter the Growth OS address exactly, for example

   ```
   https://growth-os.<your-domain>/admin/connections
   ```

   The redirect URL must match character for character (scheme, host, path, no trailing slash).
4. **Distribution.** The integration account must be able to consent to the app. Either create the app
   while signed in as the integration account, or enable sharing for the app in **Distribution** so
   the integration account can authorize it. Check the current Atlassian console wording for your
   organisation's policy.
5. **Settings.** Copy the **Client ID** and **Secret** and hand them to the Growth OS operator over
   your secret-sharing channel (never by email or chat). Do not paste them into tickets.

---

## 4. Growth OS server configuration (operator)

The Growth OS operator sets these environment variables on the API **and** worker processes. Values
are secrets or site-specific; only the names appear in documentation and in the repository.

| Variable | Value |
|---|---|
| `TASK_CONNECTOR` | `jira` (the simulated connector stays the default when unset) |
| `JIRA_CLIENT_ID` | the app's Client ID |
| `JIRA_CLIENT_SECRET` | the app's Secret |
| `JIRA_REDIRECT_URI` | the callback URL from step 3.3, exactly |
| `JIRA_API_BASE_URL` | `https://api.atlassian.com` (default) |
| `JIRA_AUTH_BASE_URL` | optional; defaults to `https://auth.atlassian.com` |
| `CONNECTOR_TOKEN_KEY` | a random 32-byte key, base64 — encrypts stored tokens (AES-256-GCM) |
| `CONNECTOR_TOKEN_KEY_PREVIOUS` | optional; the key before a rotation (decrypt only) |
| `JIRA_TIMEOUT_MS` | optional; request timeout, default 15000 |

Generate the token key with any secure generator, for example
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, and store it in your
secret manager. Tokens are stored only as ciphertext with a key fingerprint; the key, the client
secret, tokens and authorization codes are never logged, returned by the API or written to the audit
log.

---

## 5. Connect (Growth OS tenant administrator)

1. **Administration › Connections › Jira Cloud.** Enter a name, the site address
   (`https://<your-site>.atlassian.net`) and what it is used for; **Add Jira Cloud connection**. The
   connection shows **Not connected yet** (status Expired) until it is authorized.
2. **Sign in to Atlassian as the integration account** in the same browser (use a private window if
   you are signed in with your own account).
3. **Connect as integration account.** Atlassian shows the consent page with the four scopes; accept.
   Atlassian returns to Growth OS, which finishes the authorization once (the link is single use and
   valid for ten minutes) and shows **Connected · Growth OS integration**.
4. Set the task mapping (destination project, issue type, assignees) and use **Check with Jira**: it
   reads project, issue type and assignable users without creating anything.

Growth OS records who authorized the connection and when, the site, the account name and the granted
scopes (audit action `admin.connection_authorized`).

---

## 6. Rotate and revoke

**Rotate the Growth OS token key** (`CONNECTOR_TOKEN_KEY`):
1. Set `CONNECTOR_TOKEN_KEY_PREVIOUS` to the current key and `CONNECTOR_TOKEN_KEY` to a new key;
   restart the API and worker.
2. Stored tokens decrypt with the previous key and are re-encrypted with the new key at their next
   refresh (within the hour). To finish at once, **Connect as integration account** again.
3. After a day, remove `CONNECTOR_TOKEN_KEY_PREVIOUS`. A token that can no longer be decrypted shows
   the connection as **Jira connection expired**; connecting again fixes it.

**Rotate the app secret:** generate a new secret in the developer console, update
`JIRA_CLIENT_SECRET`, restart the API and worker, then use **Test** on the connection. If it shows
**Jira connection expired**, connect again as the integration account.

**Refresh tokens rotate automatically:** each refresh returns a new refresh token and invalidates the
old one. Growth OS serialises refreshes per connection so two workers never spend the same token.

**Revoke access** (any of these stops Growth OS immediately):
- In Jira, remove the integration account from the mapped projects' roles (sends then fail with a
  permission error per task), or deactivate the account; or
- as the integration account, revoke the app under **Atlassian account › Security › Connected apps**;
  or delete the app in the developer console.

After a revocation the next refresh is refused: Growth OS marks the connection **Jira connection
expired**, pauses every unsent task ("Paused — connection expired"), keeps internal task status
working and offers **Export CSV** as the fallback. Nothing is resent until an administrator connects
again **and** Growth OS re-checks each task's approval at send time; already-created issues are found
by their key and never duplicated.

**Disconnect in Growth OS:** there is no disconnect button yet (change request in the W4-E5 notes).
Until then, revoke in Atlassian as above; Growth OS then shows the connection as expired.

---

## 7. Troubleshooting

| Growth OS shows | Meaning | Fix |
|---|---|---|
| Jira connection expired | the refresh was refused (revoked, account deactivated, secret changed) | sign in as the integration account and **Connect as integration account** |
| Missing permission in a mapped project | the account lacks Browse, Create or Assign in a mapped project | grant them in that project's permission scheme |
| assignee … is not a member of project PIL | the person is not assignable there (or not found) | add the person to the project or fix the assignee mapping |
| project PIL was not found in Jira | wrong project key, or no Browse permission | fix the mapping or the permission |
| issue type Task is not available in project PIL | the issue type scheme lacks it | pick an issue type the project has |
| Unavailable | Jira or Atlassian did not answer | Growth OS retries with back-off; export CSV if it persists |

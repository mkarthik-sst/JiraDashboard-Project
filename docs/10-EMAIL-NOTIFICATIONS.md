# 10 · E-mail Notifications

The Hub e-mails the people who have to act, with a link that opens the dashboard on the right record.

| Event | Who gets the mail | Subject (example) | Link opens |
|---|---|---|---|
| **Upload** (immediate or scheduled) – defects staged in *Pending Approvals* | Each **assignee**, one digest per person per upload (several defects in one mail) | `Approval requested: 3 defects (Q4.xlsx)` | `/?tab=pending` (one defect: `&record=<id>`) |
| **Change Assignee** – defect moves to *Reassigned* | The **new assignee** (plus the optional note) | `Reassigned to you: <summary>` | `/?tab=reassigned&record=<id>` |
| **Approve** – Jira ticket created | **Assignee and reporter** (once each) | `Jira ticket JAIT-123 created: <summary>` | the Jira ticket (and the Approved tab) |

Duplicates that are suppressed never trigger a mail. A mail failure never blocks an upload, reassignment or approval; it is shown in the **E-mail notifications** panel (sent / error) and in Live logs.

## Names or e-mails in the sheet

`Assignee Email`, `Reporter Email` and the Reassign dialog accept an **e-mail or a name**.

* **Jira ticket:** e-mail or display name is resolved to a Jira account (`JIRA_USER_MAP` → the API-token owner → users assignable in the space → Jira search).
* **Mail address for a name:** `NOTIFY_USER_MAP` (`{"Rahul Verma":"rahul.verma@smartshift.com"}`) → the e-mail Jira shows for that user (often hidden by privacy) → `NOTIFY_FALLBACK_EMAIL` (receives the mail with the subject prefix `[no address for <name>]`) → otherwise a warning in the log and an error row in the panel.
* "Medisetty Karthik" and "mkarthik@smartshift.com" resolve to the same address, so that person gets one digest, not two.

## Settings (`.env.local`)

```ini
SMTP_HOST=smtp.office365.com        # empty = e-mail off, everything else keeps working
SMTP_PORT=587
SMTP_SECURE=false                   # false = STARTTLS (587); true = implicit TLS (465)
SMTP_USER=mkarthik@smartshift.com
SMTP_PASSWORD=<app password>
SMTP_FROM=CleanCore Defect Hub <mkarthik@smartshift.com>
APP_BASE_URL=https://defecthub.smartshift.com   # what the links in the mails point to
NOTIFY_USER_MAP={"Rahul Verma":"rahul.verma@smartshift.com"}
NOTIFY_FALLBACK_EMAIL=
NOTIFY_CC=
NOTIFY_ON_UPLOAD=true  NOTIFY_ON_REASSIGN=true  NOTIFY_ON_APPROVE=true
```

**APP_BASE_URL matters.** `http://localhost:3000` only works on the PC that runs the Hub. For a team, run the Hub on a server/PC others can reach and set e.g. `http://pc-name:3000` or an https name. The dashboard has no login of its own: put it on the company network or behind SSO, because anyone who can open the link can approve.

**Office 365:** the mailbox needs *Authenticated SMTP* enabled (admin centre → user → Mail → Manage e-mail apps) and, if MFA is on, an app password. If your tenant blocks SMTP AUTH use an internal relay (host + port, no user/password) or ask IT for a shared mailbox. **Gmail:** `smtp.gmail.com`, 587, app password.

## Test

```bash
curl -X POST http://localhost:3000/api/notify/test -H "content-type: application/json" -d '{"to":"mkarthik@smartshift.com"}'
```

No SMTP server handy? `node scripts/smtp-sink.mjs 1025` starts a local mail catcher that saves every mail as an .html file in `./mail-sink` (set `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, `SMTP_IGNORE_TLS=true`).

## Troubleshooting

| Error in the panel / log | Meaning | Fix |
|---|---|---|
| `Invalid login` / `535 5.7.3` / `EAUTH` | Wrong user/password, or MFA without app password | App password; check `SMTP_USER` |
| `5.7.57 Client not authenticated` / `SmtpClientAuthentication is disabled` | Authenticated SMTP disabled for the mailbox/tenant | Ask the M365 admin to enable it, or use a relay |
| `ECONNREFUSED` / `ETIMEDOUT` | Wrong host/port or firewall | Check host, 587 vs 465 (`SMTP_SECURE`), outbound rules |
| `self-signed certificate` | Inspecting proxy / internal CA | Install the CA on the machine; `SMTP_TLS_REJECT_UNAUTHORIZED=false` only as a last resort |
| `No e-mail address found for "<name>"` | Name given, no address known | Add it to `NOTIFY_USER_MAP` or write the e-mail in the sheet |
| `E-mail is off (SMTP_HOST not set)` | SMTP not configured | Set `SMTP_HOST` and restart |
| Mail lands in Junk | Sender not trusted | Ask IT to allow the sender; use an internal mailbox as `SMTP_FROM` |
| Link opens the wrong machine | `APP_BASE_URL` still `localhost` | Set it to the server's address |

## Test mode: deliver to a Yopmail inbox (NOTIFY_REDIRECT_TO)

Yopmail only RECEIVES mail; it has no SMTP server to send through. The Hub still needs a working SMTP sender (for example Gmail with an
app password, port 465) and sends the mails to the Yopmail address instead of the real assignee:

    NOTIFY_REDIRECT_TO=karthik-hub@yopmail.com
    # or per person:
    NOTIFY_REDIRECT_TO={"mkarthik@smartshift.com":"karthik-hub@yopmail.com","*":"hub-test@yopmail.com"}

The dashboard still lists the real recipient and "sent". The subject starts with `[for <real recipient>]`. Leave the setting empty in production.
Open the inbox at https://yopmail.com (type the name before the @). Yopmail inboxes are public: use test data only.

## Built-in test mailbox (v2.2.6): no second window

With `SMTP_HOST=127.0.0.1` (or `localhost`) the Hub starts its own mail catcher when it launches (`npm run start`). Settings:

    SMTP_HOST=127.0.0.1
    SMTP_PORT=1025
    SMTP_USER=
    SMTP_PASSWORD=
    APP_BASE_URL=http://localhost:3000

Every mail is saved in `./mail-sink` and listed, newest first, at http://localhost:3000/api/mail-sink (also the "Open test mailbox" link on the
E-mail notifications panel). Nothing is delivered to real inboxes. `scripts/smtp-sink.mjs` still works; if it already uses the port the Hub uses it.
For real delivery set a real SMTP_HOST (company relay, Gmail, SendGrid...), and the built-in catcher stays off.

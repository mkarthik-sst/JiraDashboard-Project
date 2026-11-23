# 12 · Engineering feedback for automated-fix defects (plain explanation)

**Goal.** When a defect (or manual QA finding) was caused by one of *our automated fixes*, product engineering must receive it at once, with root cause, impact, prerequisites and the data sources involved, instead of someone collecting this by hand days later.

## Who does what

| Step | Who | What they do | What the Hub does |
|---|---|---|---|
| 1 | Reporter / analyst | In the Excel sheet set **Automated fix issue = Yes** and fill **Fix / Rule ID, Root cause, Impact, Prerequisites, Dependent data sources** | Marks the row with a violet Fix / Rule badge |
| 2 | Reporter | Upload the sheet | Stages it in Pending Approvals. Shows **Details missing** if something is empty |
| 3 | Reviewer (assignee) | Open the defect, complete missing fields with the pencil marks, press **Approve** | Refuses to approve while a mandatory field is empty |
| 4 | (automatic) | - | Creates the Jira ticket in the **engineering Jira space** with the labels, writes an "Engineering feedback" section into the ticket, e-mails the engineering mailbox |
| 5 | **Product engineering** | Watch that Jira space (or the label `automated-fix-feedback`), pick up the ticket, fix or adjust the rule, close the ticket | - |
| 6 | Product engineering / lead | Open **Recurrence report** to see which Fix / Rule IDs produce most defects | Counts reports per Fix / Rule ID, exports to Excel |

## One-time set-up (you, the administrator)
1. Decide where engineering tickets go: a separate Jira space (e.g. key `PENG`) **or** the same space as everything else.
2. Separate space: create it in Jira (or use an existing one) and put its key in `ENGINEERING_JIRA_PROJECT_KEY`. The API user must be allowed to create issues there, and the issue types (Bug/Task/Story) must exist in it. Same space: leave the key empty and rely on labels only.
3. Labels (`ENGINEERING_JIRA_LABELS`) are created by Jira automatically. In Jira create a filter or board: `labels = automated-fix-feedback` for the engineering team.
4. `ENGINEERING_NOTIFY_EMAIL`: a real mailbox or distribution list of the engineering team, or empty for no hand-over mail.
5. `ENGINEERING_REQUIRE_MODE`: `flagged` (default), `all`, or `off` if you do not want the mandatory-fields rule at all.

## If you do not want any of this tomorrow
`ENGINEERING_REQUIRE_MODE=off`, `ENGINEERING_JIRA_PROJECT_KEY=` (empty), `ENGINEERING_NOTIFY_EMAIL=` (empty). The extra columns stay optional and everything else works as before.

## What is NOT automatic
The Hub does not work out root cause or collect prerequisite data itself; people type them. Automatic collection from customer systems is a later extension that needs scoping.

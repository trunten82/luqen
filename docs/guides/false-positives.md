[Docs](../README.md) > [Guides](../README.md#guides) > Dismissing false positives

# Dismissing false positives

A scan can report a finding that is not a real accessibility problem on your site. Dismissing it records that one rule, on one exact element of one site, is a false positive, together with the reason you give. A dismissed finding stops counting in the report's totals and scores. You can revoke a dismissal later. A dismissal is not hidden from your team: everyone who can open the site's reports in the dashboard sees what was dismissed, by whom and why.

---

## Who can dismiss

Dismissing a finding and revoking a dismissal on the report page are open to these people:

| Who | Can dismiss and revoke |
|-----|------------------------|
| A global administrator | Yes, on the scans of every organization and on scans that belong to no organization. |
| The default **Owner** and **Admin** roles of an organization | Yes, on the scans of that organization. |
| A custom role of an organization | Only when the person's permissions in that organization include **Mark findings as false positives**, **View reports** and **View technical details (selectors, context)**. |
| The default **Member**, **Executive** and **Viewer** roles | No. |

A person's permissions in an organization are those of their global role together with those of the roles of every team they belong to in that organization. **View reports** and **View technical details (selectors, context)** can therefore come from the global role. **Mark findings as false positives** cannot, except for a global administrator, who holds every permission: otherwise only a role of the organization can hold it. To give it to a custom role, see [Let a custom role dismiss findings](#let-a-custom-role-dismiss-findings).

The permission **Mark findings as false positives** alone is not enough on the report page. The **Dismiss** button appears only for people who can also see technical details, because a dismissal names the exact element it covers.

You can dismiss and revoke only on the scans of the organization you are working in. If you belong to several organizations, choose the organization in the list under **Organization** at the bottom of the menu (the menu shows the heading in capital letters) before you open the report. Anyone in an organization can open a scan that belongs to no organization and read its Dismissed findings section, but only a global administrator can dismiss or revoke on it.

An organization API key created with the role **Admin** can also dismiss and revoke, through the API; see [Issue dismissals](../reference/api-reference.md#issue-dismissals) in the API reference.

---

## Mark a finding as a false positive

Record that one finding is a false positive, so that it stops counting against the site.

Before you start:

- You can dismiss (see [Who can dismiss](#who-can-dismiss)).
- The scan has finished. Only the findings of a completed scan can be dismissed.
- The scan belongs to the organization you are working in.

Steps:

1. At the top left of the page, click the menu button **Open navigation menu**.
2. In the menu, click **Reports**.
3. In the list, click the site address of the scan. The list starts with the newest scan, and each row shows the date and time of its scan and its status. When the site has been scanned more than once, its address is listed once for each scan: click the newest completed one, the highest of them in the list.
4. Click the **Issues** tab. On a wide screen the report's tabs are listed down the left side of the report; on a narrow screen they run across the top.
5. Find the criterion the finding is listed under, and click the criterion's title to expand it. Do not click the criterion number in front of the title: it is a link that opens the WCAG page in a new tab.
6. On the finding you want to dismiss, click **Dismiss**.
   When the same finding is listed more than once (once for each page it is on), the rows look the same, because they do not show which page each one is on. Click **Dismiss** on any one of them: one dismissal covers them all. A finding that repeats on many pages as part of a shared component has the same **Dismiss** button on the **Templates** tab as well, once you click the component's name there to expand it.
   If **Dismiss** is greyed out, the finding cannot be dismissed and clicking it does nothing. Point at the button to see why; the reasons are listed in [Which findings a dismissal covers](#which-findings-a-dismissal-covers).
7. Check the dialog **Dismiss as false positive**: **Rule**, **Element** and **Finding** show the finding you chose. Wait until **Occurrences in this scan** and **Pages in this scan** show numbers. They count what the dismissal covers in this scan; when more than one occurrence is counted, all of them are dismissed together.
8. Type your reason in **Reason**: say why the finding is a false positive, in up to 1000 characters.
   The reason is required because it is the record of the decision. Everyone who can open the site's reports sees it next to your name, and it also appears in the Excel export and in the audit log. The hint under the box says the same: your name and the reason are shown to everyone who can view the report.
9. Click **Dismiss as false positive** at the bottom of the dialog, next to **Cancel**. The dialog's title uses the same words; the button is the one at the bottom. It stays unavailable until the counts have loaded and a reason is typed.

Result: the page reloads on the same tab and shows **Finding dismissed. Scans of this site updated: N.** This message closes by itself after about five seconds; what stays is the following. The finding is no longer in the list or in the totals. At the end of the **Issues** tab, **Dismissed findings — active: N, revoked: N** appears; expand it to see the dismissal, its reason and who made it.

If it does not work: when there is no **Dismiss** button on the finding, check [Who can dismiss](#who-can-dismiss) and that the scan belongs to the organization you are working in. When the button is there but greyed out, the finding itself cannot be dismissed: see [Which findings a dismissal covers](#which-findings-a-dismissal-covers). If something else goes wrong, see [When the Dismiss button is missing or disabled](#when-the-dismiss-button-is-missing-or-disabled) and [Messages you may see](#messages-you-may-see).

---

## Which findings a dismissal covers

A dismissal matches a finding when all four of these are the same:

- The rule code, shown as **Rule** in the dialog.
- The element's selector, shown as **Element** in the dialog, character for character. If the page changes and a later scan reports the element with a different selector, the dismissal no longer matches it and the finding is listed again.
- The site, which is the address the scan was started with. Two addresses are the same site when they have the same scheme, host name, path and query. Capitals in the host name, the default port and slashes at the end of the path make no difference. An `http://` address and an `https://` address are different sites, and so are `https://fabrikam.example/` and `https://fabrikam.example/shop`.
- The organization that owns the scan. A scan of the same address by another organization is not affected.

Within a scan, every occurrence that matches is dismissed together: the same finding on every page it is on, and its entry in the **Shared components — fix once, fix everywhere** block when the finding is part of a shared component. This is why the dialog shows **Occurrences in this scan** and **Pages in this scan** before you confirm.

The **Dismiss** button is next to each finding on the **Issues** tab, and next to each shared component's finding on the **Templates** tab, where you first click the component's name to expand it. The **Pages** tab has no **Dismiss** button.

Some findings cannot be dismissed. Their **Dismiss** button is shown greyed out, and pointing at it shows one of these messages:

| Message | Why |
|---------|-----|
| **This finding has no specific element and cannot be dismissed.** | The finding is reported against the whole page (for example its `html` or `body` element) or against no element at all. A dismissal on the whole page would hide every finding reported against it. |
| **This finding's element selector is too long to be dismissed.** | The element's selector is longer than 4000 characters. |
| **This finding has no rule code and cannot be dismissed.** | The finding has no rule code. |
| **This finding's rule code is too long to be dismissed.** | The rule code is longer than 300 characters. |

---

## What a dismissal changes

A dismissal changes what the dashboard counts and reports for the site. Nothing is deleted from the scan: the stored report stays complete, and the dismissals are applied each time results are read and each time the totals are recomputed. Revoking a dismissal therefore brings every count back.

### Counts and scores

The dismissed finding leaves the report's totals and is no longer listed on the **Issues**, **Templates** and **Pages** tabs or in the print view that **Print / PDF** opens. Every page that shows issue totals or scores for the scan agrees with the report:

- the **Home** page: **Issues Found** and the **Recent activity** list;
- the **Reports** list;
- **Trends**: the **Accessibility Score** and the score of each site;
- the site's badge (**Shareable badges**);
- the **Legal Exposure Indicator** on the report;
- the **Fleet** page and the scheduled digests (**Digest Schedules**).

### Compliance and regulation matrices

When a scan was run with jurisdictions or regulations, the report's **Compliance** tab shows the **Legal Compliance Matrix** (**By Jurisdiction**) and the **Per-regulation breakdown** (**By Regulation**), which list the WCAG criteria each jurisdiction and regulation fails. There, a criterion stops showing as failing only when no finding behind it remains in the report, whatever its rule. While another finding of the same rule is still listed, for example on a different element, the criterion stays failing and its count in the matrix does not change. This is the one place where a single dismissal may not move a number.

### Exports

**Export Excel** on the report downloads a workbook whose **Issues** sheet leaves the dismissed finding out. Whenever something on the report is dismissed, the workbook also has a sheet named **Dismissed**, with one row for each dismissed occurrence and these columns, in this order: **Page URL**, **Rule Code**, **Selector**, **Level**, **Reason**, **Dismissed By** and **Dismissed At**. **Dismissed By** says who dismissed the finding. **Dismissed At** is the date and time of the dismissal as stored, in UTC, written like `2026-10-21T09:30:00.000Z`.

**Download PDF** on the report leaves the dismissed finding out and has no section about dismissals.

The workbooks that **Export Excel** downloads from the **Reports** list and from the **Issue Trends** page count issues without the dismissed finding, as the report does.

### Conformance reports and the accessibility statement

**Generate VPAT / ACR** on the report opens the conformance report in a new tab. There, the dismissed finding no longer counts against its WCAG criterion, and that criterion's **Remarks and Explanations** end with one of these sentences:

- **1 automated finding was dismissed as a false positive after review.**
- **N automated findings were dismissed as false positives after review.**

The same sentence appears wherever the conformance report is produced: its **Download PDF**, its evidence pack, and the shared and public links to it.

The public accessibility statement lists every criterion with dismissed findings under **Automated findings dismissed after review**, one line per criterion ending in **N automated finding(s) dismissed as false positives after review**. In the dashboard, the preview on the **Accessibility Statement** page shows **Criteria with dismissed findings:** followed by their number.

These documents carry counts only: never the reason, and never who dismissed the finding. The public report, share links and the print view do not show the Dismissed findings section at all.

### Earlier and later scans of the same site

A dismissal applies to every completed scan of the site in your organization: to the scans made before it, and to every later scan, as long as the rule and the selector still match. When you dismiss, the stored totals of all those scans are updated at once; the number in **Finding dismissed. Scans of this site updated: N.** is how many of the site's scans were updated. A later scan saves its totals without the dismissed finding, and every report page applies the dismissals that are active when you open it. A scan of the same address by another organization is not affected.

If some of the site's scans could not be updated, one of these messages appears instead, and it stays until you close it:

- **Saved, but N scans of this site could not be updated. Totals on the home page and trends may be out of date for them.**
- **Saved, but the other scans of this site could not be fully updated. Totals on the home page and trends may be out of date.**

The dismissal is saved either way, and the report pages of those scans already leave the finding out, because they apply the dismissal when they are opened. Only the stored totals of those scans, which the home page and trends show, may be out of date. The next dismissal or revocation on the same site updates every scan of the site again.

---

## Check a dismissal on a new scan

See for yourself that a dismissal already applies to a new scan of the same site.

Before you start:

- A dismissal is active for the site (see [Mark a finding as a false positive](#mark-a-finding-as-a-false-positive)).
- Your role holds **Create scans**, so that you can start a scan.

Steps:

1. At the top left of the page, click the menu button **Open navigation menu**.
2. In the menu, click **New Scan**, the entry just below Reports. If the page behind the menu has a **New Scan** button of its own, that button opens the same page.
3. Type the site's address in **Website URL**, written as it was for the scan you dismissed the finding on. What counts as the same site is explained in [Which findings a dismissal covers](#which-findings-a-dismissal-covers).
4. Click **Start Scan**. The other options on this page are described in [Starting a scan](scanning.md#starting-a-scan); they do not affect the dismissal.
5. Wait until the scan is complete. The progress page then shows **Scan completed! Redirecting to report…** and, a few seconds later, opens the scan's report by itself.
6. Click the **Issues** tab.
7. If the criterion the dismissed finding was listed under is still listed, click its title to expand it.

Result: the dismissed finding is not listed, and the report's totals do not count it. At the end of the **Issues** tab, **Dismissed findings — active: N, revoked: N** is shown; expand it to see the dismissal under **Active dismissals**.

If it does not work: when the dismissed finding is listed again, compare its element with the one shown for the dismissal under **Active dismissals**. If the selector has changed, or the scan was started with a different address, the dismissal does not match (see [Which findings a dismissal covers](#which-findings-a-dismissal-covers)). If something else goes wrong, see [When the Dismiss button is missing or disabled](#when-the-dismiss-button-is-missing-or-disabled) and [Messages you may see](#messages-you-may-see).

---

## Find dismissed findings in the Excel export

Check in a spreadsheet which findings a report leaves out, and why.

Before you start:

- Your role holds **Export CSV and PDF**.
- The report has at least one active dismissal.

Steps:

1. At the top left of the page, click the menu button **Open navigation menu**.
2. In the menu, click **Reports**.
3. In the list, click the site address of the scan. The list starts with the newest scan, and each row shows the date and time of its scan and its status. When the site has been scanned more than once, its address is listed once for each scan: click the newest completed one, the highest of them in the list.
4. In the row of buttons at the top of the report, click **Export Excel**. Your browser downloads a workbook.
5. Open the downloaded workbook in a spreadsheet application.

Result: the workbook has a sheet **Issues**, which does not list the dismissed findings, and a sheet **Dismissed**, with one row for each dismissed occurrence under the headings **Page URL**, **Rule Code**, **Selector**, **Level**, **Reason**, **Dismissed By** and **Dismissed At**.

If it does not work: when the workbook has no **Dismissed** sheet, nothing on this report is dismissed. The Dismissed findings section at the end of the report's **Issues** tab shows the site's active dismissals. If something else goes wrong, see [When the Dismiss button is missing or disabled](#when-the-dismiss-button-is-missing-or-disabled) and [Messages you may see](#messages-you-may-see).

---

## See the disclosure in the conformance report

See how a conformance report (VPAT / ACR) discloses dismissed findings.

Before you start:

- Your role holds **Generate and export VPAT/ACR reports**.
- The report has at least one active dismissal.

Steps:

1. At the top left of the page, click the menu button **Open navigation menu**.
2. In the menu, click **Reports**.
3. In the list, click the site address of the scan. The list starts with the newest scan, and each row shows the date and time of its scan and its status. When the site has been scanned more than once, its address is listed once for each scan: click the newest completed one, the highest of them in the list.
4. In the row of buttons at the top of the report, click **Generate VPAT / ACR**. The conformance report opens in a new tab.
5. In the conformance report's tables, find the row of the criterion the dismissed finding was listed under. The criterion's number and name are in the first column, **Criteria**; the page shows the column headings in capital letters.

Result: the row's last column, **Remarks and Explanations**, ends with **1 automated finding was dismissed as a false positive after review.** When more than one occurrence on that criterion is dismissed, it ends with **N automated findings were dismissed as false positives after review.** instead. The same sentence is in the conformance report's **Download PDF**, in its evidence pack and in its shared and public links (see [Conformance reports and the accessibility statement](#conformance-reports-and-the-accessibility-statement)).

If it does not work: when no row carries the sentence, check that the dismissal is listed under **Active dismissals** in the Dismissed findings section at the end of the report's **Issues** tab. If something else goes wrong, see [When the Dismiss button is missing or disabled](#when-the-dismiss-button-is-missing-or-disabled) and [Messages you may see](#messages-you-may-see).

---

## Revoke a dismissal

Undo a dismissal, so that the finding counts against the site again.

Before you start:

- You can dismiss (see [Who can dismiss](#who-can-dismiss)). Revoking needs the same permissions as dismissing.
- The site has an active dismissal, and the scan you open belongs to the organization you are working in.

Steps:

1. At the top left of the page, click the menu button **Open navigation menu**.
2. In the menu, click **Reports**.
3. In the list, click the site address of the site whose dismissal you want to revoke. When the site has been scanned more than once, its address is listed once for each scan, newest first: click the newest completed one, the highest of them in the list.
4. Click the **Issues** tab.
5. At the end of the tab, click **Dismissed findings — active: N, revoked: N** to expand it.
6. Under **Active dismissals**, on the row of the dismissal you want to undo, click **Revoke**. The table's first column, **Rule**, shows the rule code of each dismissal; the page shows the table's column headings in capital letters.
7. Check the dialog **Revoke dismissal**: **Rule** shows the rule code of the dismissal you chose.
8. If you want to record why, type it in **Comment (optional)**, in up to 1000 characters. The comment is not required.
9. Click **Revoke dismissal** at the bottom of the dialog, next to **Cancel**. The dialog's title uses the same words; the button is the one at the bottom.

Result: the page reloads on the same tab and shows **Dismissal revoked. Scans of this site updated: N.** This message closes by itself after about five seconds. The finding is listed and counted again, in this scan and in every other scan of the site, earlier ones included. Click **Dismissed findings — active: N, revoked: N** again to expand it: the dismissal is now under **Revoked dismissals**, with **Revoked by**, **Revoked on** and **Comment** filled in.

To dismiss the same finding again later, mark it again as described in [Mark a finding as a false positive](#mark-a-finding-as-a-false-positive). A new dismissal is created; the revoked one stays under **Revoked dismissals** as part of the history.

If it does not work: when there is no **Revoke** button, check [Who can dismiss](#who-can-dismiss) and that the scan belongs to the organization you are working in. If something else goes wrong, see [When the Dismiss button is missing or disabled](#when-the-dismiss-button-is-missing-or-disabled) and [Messages you may see](#messages-you-may-see).

---

## Read the audit history

Every dismissal and every revocation is recorded: who did it, when, and the reason or comment they gave. You can read this history in three places.

### On the report page

See every dismissal of a site, active and revoked, on any report of that site.

Before you start:

- You can open the site's reports.
- The site has at least one dismissal, active or revoked. Without one, the section is not shown.

Steps:

1. At the top left of the page, click the menu button **Open navigation menu**.
2. In the menu, click **Reports**.
3. In the list, click the site address of a scan of the site. When the site has been scanned more than once, its address is listed once for each scan, newest first: click the newest completed one, the highest of them in the list.
4. Click the **Issues** tab.
5. At the end of the tab, click **Dismissed findings — active: N, revoked: N** to expand it.

Result: **Active dismissals** lists the dismissals in force, under the columns **Rule**, **Element**, **Reason**, **Dismissed by** and **Dismissed on**. When at least one dismissal has been revoked, **Revoked dismissals** lists those too, with three more columns: **Revoked by**, **Revoked on** and **Comment**. The page shows the column headings in capital letters. When nothing is dismissed any more, **No active dismissals.** is shown under **Active dismissals**.

- The **Element** column, which shows the element's selector, is shown only to people whose role holds **View technical details (selectors, context)**.
- Dates and times are written in the language you use the dashboard in, and in the time zone of the server the dashboard runs on.
- A dismissal made through the API with an API key of the scan's organization names the key, for example **API key: Fabrikam CI**, followed in brackets by **Created** and the date the key was created. The date tells apart two keys with the same name, and the name is kept after the key is deleted. A key that is not one of the organization's own is shown only as **API key**.
- The section is shown only in the dashboard. The public report, share links, the print view and conformance reports never show it.

If it does not work: see [When the Dismiss button is missing or disabled](#when-the-dismiss-button-is-missing-or-disabled).

### In the audit log

Find the audit log entries that record each dismissal and each revocation.

Before you start:

- Your role holds **View audit log**. The default Owner role holds it and the default Admin role does not; global administrators hold it too.

Steps:

1. In your browser's address bar, open your dashboard's address followed by `/admin/audit-log?action=issue_dismissal.mark`, for example `https://luqen.fabrikam.example/admin/audit-log?action=issue_dismissal.mark`. The **Audit Log** page lists the dismissals that were made.
2. To list the revocations, open your dashboard's address followed by `/admin/audit-log?action=issue_dismissal.revoke` instead.
3. The newest entries come first, 50 at a time. When the list ends with **Load More**, click **Load More** to see the next ones; the same filter stays applied.

Result: each entry shows **Timestamp**, **Actor**, **Action** (`issue_dismissal.mark` or `issue_dismissal.revoke`), **Resource Type** (`issue_dismissal`), **Resource ID**, **Details**, **IP Address** and **Org**. The page shows the column headings in capital letters. **Details** holds the site address, the rule code and the selector, with the reason of a dismissal or the comment of a revocation. Unless you are a global administrator, only the entries of the organization you are working in are listed.

If it does not work: when the address does not open the page and reports that access is forbidden, your role does not hold **View audit log**; ask an Owner of your organization. If something else goes wrong, see [When the Dismiss button is missing or disabled](#when-the-dismiss-button-is-missing-or-disabled) and [Messages you may see](#messages-you-may-see).

### Through the API

The dashboard's API returns every dismissal of a scan's site, active and revoked, each with its history of dismissal and revocation. Reading the list needs **View reports**. See [Issue dismissals](../reference/api-reference.md#issue-dismissals) in the API reference.

---

## Let a custom role dismiss findings

Give the right to dismiss to people who hold neither the Owner nor the Admin role, through a role of your own.

Before you start:

- You are an Owner of the organization or a global administrator. Creating a role needs **Manage roles** and changing teams needs **Manage teams**; the default Owner role holds both and the default Admin role neither.
- You are working in the organization (see [Who can dismiss](#who-can-dismiss) for how to choose it).
- The person already has an account in the dashboard. For an Owner, **Add Member** lists only people who are already in one of the organization's teams; a global administrator's list holds every active user. A person who is in none of the organization's teams is added by a global administrator (see step 20).

Steps:

1. At the top left of the page, click the menu button **Open navigation menu**.
2. If **Roles** is not listed in the menu, click **More**, near the end of the menu; the menu shows it in capital letters. More entries appear below it.
3. Click **Roles**.
4. Click the tab whose name starts with **Organization Roles**. The rest of its name is your organization's name in brackets, for example *Organization Roles (Fabrikam)*.
5. Above the list of the organization's roles, click **Create Role**.
6. In **Role Name**, type a name made of letters, numbers, hyphens and underscores only, for example *fp-reviewer*. Spaces are not accepted.
7. In **Description**, type what the role is for.
8. Under **Permissions**, tick **Mark findings as false positives**. Each permission is listed by its name, with its identifier beside it in smaller type.
9. Tick **View reports**.
10. Tick **View technical details (selectors, context)**.
11. At the bottom of the form, click **Create Role**. The roles page opens again on its **Global Roles** tab; the new role is listed on the tab whose name starts with **Organization Roles**.
12. At the top left of the page, click the menu button **Open navigation menu**.
13. If **Teams** is not listed in the menu, click **More**, near the end of the menu; the menu shows it in capital letters. More entries appear below it.
14. Click **Teams**.
15. In **Team Name**, type a name for a new team, for example *Accessibility reviewers*.
16. In **Organization**, choose the organization you are working in.
17. In **Team Role**, choose the role you created.
18. Click **Create Team**. The team is added to the list below.
19. In the list, click the team's name. The team's page opens.
20. In **Add Member**, choose the person. Each person is listed by user name, followed by their global role in brackets.
   If you are an Owner and the person is not in the list, they are in none of the organization's teams. Ask a global administrator to add them: a global administrator opens this team's page through steps 12, 13, 14 and 19, and does this step and the next.
21. Click the **Add Member** button next to the list. The person is added to the team's members. In the members table, the **Team Role** column (shown in capital letters) reads *member*: that is the person's place in the team, not the role. The role the team gives is the one named at the top of the page, under **Team Role**.

Result: the next page the person opens shows them **Dismiss** next to the findings on the organization's reports, and **Revoke** in the Dismissed findings section.

To give the role to an existing team instead, open that team's page, choose the role in the **Role Name** list under **Team Role**, and click **Update Role**. Every member of that team then holds the role in the organization. The **Global Roles** tab never offers **Mark findings as false positives**, because a role created there cannot hold it.

If it does not work: open the role again from **Roles** and check that the three permissions are ticked, and check on the team's page that **Team Role** names the role. If something else goes wrong, see [When the Dismiss button is missing or disabled](#when-the-dismiss-button-is-missing-or-disabled).

---

## When the Dismiss button is missing or disabled

| What you see | Why | What to do |
|--------------|-----|------------|
| No **Dismiss** button on any report. | Your role in the organization does not hold both **Mark findings as false positives** and **View technical details (selectors, context)**. The default **Member**, **Executive** and **Viewer** roles do not hold **Mark findings as false positives**. | Ask an Owner of your organization to give you a role that does; see [Let a custom role dismiss findings](#let-a-custom-role-dismiss-findings). |
| **Dismiss** on one organization's reports, but not on a scan you can open. | The scan does not belong to the organization you are working in. A scan that belongs to no organization can be opened by everyone, but only a global administrator can dismiss on it. | Choose the scan's organization in the list under **Organization** at the bottom of the menu, then open the report again. |
| **Dismiss** greyed out, and pointing at it shows **This finding has no specific element and cannot be dismissed.** | The finding is reported against the whole page or against no element. | Nothing: this finding cannot be dismissed. See [Which findings a dismissal covers](#which-findings-a-dismissal-covers). |
| **Dismiss** greyed out, and pointing at it shows **This finding's element selector is too long to be dismissed.** | The element's selector is longer than 4000 characters. | Nothing: this finding cannot be dismissed. |
| **Dismiss** greyed out, and pointing at it shows **This finding has no rule code and cannot be dismissed.** | The finding has no rule code. | Nothing: this finding cannot be dismissed. |
| **Dismiss** greyed out, and pointing at it shows **This finding's rule code is too long to be dismissed.** | The rule code is longer than 300 characters. | Nothing: this finding cannot be dismissed. |
| No findings at all, only the scan's details and its status. | The scan has not completed. Only a completed scan lists findings. | Wait until the scan is complete, then open its report again. |
| No **Dismiss** on the **Pages** tab. | The **Pages** tab has no **Dismiss** button. | Use the **Issues** tab, or the **Templates** tab for a shared component. |
| No **Revoke** button in the Dismissed findings section. | Revoking needs the same permissions and the same organization as dismissing. | See the first two rows of this table. |
| No **Element** column in the Dismissed findings section. | Your role does not hold **View technical details (selectors, context)**. | Nothing to fix: the rest of the section is the same for you. |
| No **Dismissed findings — active: N, revoked: N** at the end of the **Issues** tab. | The site has no dismissal, active or revoked, in the scan's organization. | Nothing to fix. |

---

## Messages you may see

The messages below appear in the **Dismiss as false positive** and **Revoke dismissal** dialogs, or after the page reloads.

While the dialog **Dismiss as false positive** checks what a dismissal would cover:

| Message | When it appears | What to do |
|---------|-----------------|------------|
| **Checking what this covers in this scan…** | The dialog is counting the occurrences. | Wait until **Occurrences in this scan** and **Pages in this scan** show numbers. |
| **Every occurrence counted above is dismissed together, including any that are listed separately in this report.** | More than one occurrence matches the finding. | Nothing: one dismissal covers them all. |
| **This scan has no finding that matches this rule and element, so there is nothing to dismiss.** | The scan has no matching finding. | Close the dialog with **Cancel**. |
| **This rule on this exact element is already dismissed for this site, so there is nothing to dismiss. Reload the page to see it under Dismissed findings.** | Someone has dismissed the finding since you opened the page. | Reload the page. |
| **Could not check what this covers. Try again.** | The dashboard could not be reached, or was busy. | Click **Try again**. |
| **This finding has no specific element and cannot be dismissed.** | The finding is reported against the whole page or against no element. | Close the dialog: the finding cannot be dismissed. |
| **This finding's element selector is too long to be dismissed.** | The element's selector is longer than 4000 characters. | Close the dialog: the finding cannot be dismissed. |
| **This finding cannot be dismissed: the request was refused.** | The dashboard refused the rule code or the selector. | Close the dialog: the finding cannot be dismissed. |
| **This scan's report is not available, so nothing can be dismissed.** | The scan has not completed, or its stored report cannot be read. | Close the dialog and open the report again later. |
| **This finding cannot be dismissed.** | Any other refusal. | Close the dialog. |

After you click **Dismiss as false positive** or **Revoke dismissal**, the dialog stays open and shows one of these messages when the dashboard refuses the change. What you typed is kept.

| Message | When it appears | What to do |
|---------|-----------------|------------|
| **This finding cannot be dismissed, or the reason is not valid. Check the reason and try again.** | The reason is empty or longer than 1000 characters, or the finding cannot be dismissed. | Check the reason. |
| **This dismissal cannot be revoked, or the comment is not valid. Check the comment and try again.** | The comment is longer than 1000 characters. | Shorten the comment. |
| **Your session has expired. Sign in again, then repeat this.** | You were signed out. | Sign in again, then repeat the dismissal or revocation. |
| **You do not have permission to do this.** | Your permissions changed since the page was opened. | See [Who can dismiss](#who-can-dismiss). |
| **This report or dismissal no longer exists. Reload the page.** | The scan or the dismissal was deleted, or it does not belong to the organization you are working in now. | Reload the page. |
| **This finding is already dismissed. Reload the page to see it under Dismissed findings.** | Someone dismissed the same finding a moment before you. | Reload the page. |
| **This dismissal was already revoked. Reload the page.** | Someone revoked the dismissal a moment before you. | Reload the page. |
| **This report has no matching finding to dismiss.** | The scan has no finding with this rule and element, it has not completed, or its stored report cannot be read. | Reload the page. |
| **Too many requests. Wait a minute and try again.** | More than 60 dismissals, or more than 60 revocations, were sent from your network address within a minute. | Wait a minute, then try again. |
| **Dismissals are not available on this server.** | The dashboard's database does not support dismissals. | Ask the administrator of your dashboard. |
| **Something went wrong. Check your connection and try again.** | Any other failure, for example a lost connection. | Check your connection and try again. |

After the page reloads, one of these messages appears:

| Message | When it appears | What to do |
|---------|-----------------|------------|
| **Finding dismissed. Scans of this site updated: N.** | The dismissal was saved and the totals of N scans of the site were updated. It closes after about five seconds. | Nothing. |
| **Dismissal revoked. Scans of this site updated: N.** | The revocation was saved and the totals of N scans of the site were updated. It closes after about five seconds. | Nothing. |
| **Saved, but N scans of this site could not be updated. Totals on the home page and trends may be out of date for them.** | The change was saved, but the stored totals of N of the site's scans were not updated. It stays until you close it. | Nothing urgent: the report pages are right. The next dismissal or revocation on the site updates every scan again. |
| **Saved, but the other scans of this site could not be fully updated. Totals on the home page and trends may be out of date.** | The change was saved, but the update of the other scans did not finish. It stays until you close it. | As above. |

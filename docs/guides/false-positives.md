[Docs](../README.md) > [Guides](../README.md#guides) > Dismissing false positives

# Dismissing false positives

A scan can report a finding that is not a real accessibility problem on your site. Dismissing it records that one rule, on one exact element of one site, is a false positive, together with the reason you give. A dismissed finding stops counting in the report's totals and scores. You can revoke a dismissal later. A dismissal is not hidden from your team: everyone who can open the site's reports in the dashboard sees what was dismissed, by whom and why.

---

## Who can dismiss

You can dismiss findings when one of these applies:

- Your role in the organization is **Owner** or **Admin**. Both default roles can dismiss.
- You are a global administrator. A global administrator can dismiss on the scans of any organization.
- Your role in the organization is a custom role that holds **Mark findings as false positives** together with **View reports** and **View technical details (selectors, context)**.

The permission **Mark findings as false positives** alone is not enough on the report page. The **Dismiss** button appears only for people who can also see technical details, because a dismissal names the exact element it covers. The default **Member**, **Executive** and **Viewer** roles cannot dismiss.

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
3. In the list, click the site address of the scan.
4. Click the **Issues** tab. On a wide screen the report's tabs are listed down the left side of the report; on a narrow screen they run across the top.
5. Find the criterion the finding is listed under, and click the criterion's title to expand it. Do not click the criterion number in front of the title: it is a link that opens the WCAG page in a new tab.
6. On the finding you want to dismiss, click **Dismiss**.
   When the same finding is listed more than once (once for each page it is on), the rows look the same, because they do not show which page each one is on. Click **Dismiss** on any one of them: one dismissal covers them all. A finding that repeats on many pages as part of a shared component has the same **Dismiss** button on the **Templates** tab as well.
   If **Dismiss** is greyed out, the finding cannot be dismissed and clicking it does nothing. Point at the button to see why; the reasons are listed in [Which findings a dismissal covers](#which-findings-a-dismissal-covers).
7. Check the dialog **Dismiss as false positive**: **Rule**, **Element** and **Finding** show the finding you chose. Wait until **Occurrences in this scan** and **Pages in this scan** show numbers. They count what the dismissal covers in this scan; when more than one occurrence is counted, all of them are dismissed together.
8. Type your reason in **Reason**: say why the finding is a false positive, in up to 1000 characters.
   The reason is required because it is the record of the decision. Everyone who can open the site's reports sees it next to your name, and it also appears in the Excel export and in the audit log. The hint under the box says the same: your name and the reason are shown to everyone who can view the report.
9. Click **Dismiss as false positive** at the bottom of the dialog, next to **Cancel**. The dialog's title uses the same words; the button is the one at the bottom. It stays unavailable until the counts have loaded and a reason is typed.

Result: the page reloads on the same tab and shows **Finding dismissed. Scans of this site updated: N.** This message closes by itself after about five seconds; what stays is the following. The finding is no longer in the list or in the totals. At the end of the **Issues** tab, **Dismissed findings — active: N, revoked: N** appears; expand it to see the dismissal, its reason and who made it.

If it does not work: when there is no **Dismiss** button on the finding, check [Who can dismiss](#who-can-dismiss) and that the scan belongs to the organization you are working in. When the button is there but greyed out, the finding itself cannot be dismissed: see [Which findings a dismissal covers](#which-findings-a-dismissal-covers).

---

## Which findings a dismissal covers

A dismissal matches a finding when all four of these are the same:

- The rule code, shown as **Rule** in the dialog.
- The element's selector, shown as **Element** in the dialog, character for character. If the page changes and a later scan reports the element with a different selector, the dismissal no longer matches it and the finding is listed again.
- The site, which is the address the scan was started with. Two addresses are the same site when they have the same scheme, host name, path and query. Capitals in the host name, the default port and slashes at the end of the path make no difference. An `http://` address and an `https://` address are different sites, and so are `https://fabrikam.example/` and `https://fabrikam.example/shop`.
- The organization that owns the scan. A scan of the same address by another organization is not affected.

Within a scan, every occurrence that matches is dismissed together: the same finding on every page it is on, and its entry in the **Shared components — fix once, fix everywhere** block when the finding is part of a shared component. This is why the dialog shows **Occurrences in this scan** and **Pages in this scan** before you confirm.

The **Dismiss** button is next to each finding on the **Issues** tab, and next to each shared component's finding on the **Templates** tab. The **Pages** tab has no **Dismiss** button.

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

If it does not work: when the dismissed finding is listed again, compare its element with the one shown for the dismissal under **Active dismissals**. If the selector has changed, or the scan was started with a different address, the dismissal does not match (see [Which findings a dismissal covers](#which-findings-a-dismissal-covers)).

---

## Find dismissed findings in the Excel export

Check in a spreadsheet which findings a report leaves out, and why.

Before you start:

- Your role holds **Export CSV and PDF**.
- The report has at least one active dismissal.

Steps:

1. At the top left of the page, click the menu button **Open navigation menu**.
2. In the menu, click **Reports**.
3. In the list, click the site address of the scan.
4. In the row of buttons at the top of the report, click **Export Excel**. Your browser downloads a workbook.
5. Open the downloaded workbook in a spreadsheet application.

Result: the workbook has a sheet **Issues**, which does not list the dismissed findings, and a sheet **Dismissed**, with one row for each dismissed occurrence under the headings **Page URL**, **Rule Code**, **Selector**, **Level**, **Reason**, **Dismissed By** and **Dismissed At**.

If it does not work: when the workbook has no **Dismissed** sheet, nothing on this report is dismissed. The Dismissed findings section at the end of the report's **Issues** tab shows the site's active dismissals.

---

## See the disclosure in the conformance report

See how a conformance report (VPAT / ACR) discloses dismissed findings.

Before you start:

- Your role holds **Generate and export VPAT/ACR reports**.
- The report has at least one active dismissal.

Steps:

1. At the top left of the page, click the menu button **Open navigation menu**.
2. In the menu, click **Reports**.
3. In the list, click the site address of the scan.
4. In the row of buttons at the top of the report, click **Generate VPAT / ACR**. The conformance report opens in a new tab.
5. In the conformance report's tables, find the row of the criterion the dismissed finding was listed under. The criterion's number and name are in the first column, **Criteria**; the page shows the column headings in capital letters.

Result: the row's last column, **Remarks and Explanations**, ends with **1 automated finding was dismissed as a false positive after review.** When more than one occurrence on that criterion is dismissed, it ends with **N automated findings were dismissed as false positives after review.** instead. The same sentence is in the conformance report's **Download PDF**, in its evidence pack and in its shared and public links (see [Conformance reports and the accessibility statement](#conformance-reports-and-the-accessibility-statement)).

If it does not work: when no row carries the sentence, check that the dismissal is listed under **Active dismissals** in the Dismissed findings section at the end of the report's **Issues** tab.

---

## Revoke a dismissal

Undo a dismissal, so that the finding counts against the site again.

Before you start:

- You can dismiss (see [Who can dismiss](#who-can-dismiss)). Revoking needs the same permissions as dismissing.
- The site has an active dismissal, and the scan you open belongs to the organization you are working in.

Steps:

1. At the top left of the page, click the menu button **Open navigation menu**.
2. In the menu, click **Reports**.
3. In the list, click the site address of a scan of the site.
4. Click the **Issues** tab.
5. At the end of the tab, click **Dismissed findings — active: N, revoked: N** to expand it.
6. Under **Active dismissals**, on the row of the dismissal you want to undo, click **Revoke**. The table's first column, **Rule**, shows the rule code of each dismissal; the page shows the table's column headings in capital letters.
7. Check the dialog **Revoke dismissal**: **Rule** shows the rule code of the dismissal you chose.
8. If you want to record why, type it in **Comment (optional)**, in up to 1000 characters. The comment is not required.
9. Click **Revoke dismissal** at the bottom of the dialog, next to **Cancel**. The dialog's title uses the same words; the button is the one at the bottom.

Result: the page reloads on the same tab and shows **Dismissal revoked. Scans of this site updated: N.** This message closes by itself after about five seconds. The finding is listed and counted again, in this scan and in every other scan of the site, earlier ones included. Click **Dismissed findings — active: N, revoked: N** again to expand it: the dismissal is now under **Revoked dismissals**, with **Revoked by**, **Revoked on** and **Comment** filled in.

To dismiss the same finding again later, mark it again as described in [Mark a finding as a false positive](#mark-a-finding-as-a-false-positive). A new dismissal is created; the revoked one stays under **Revoked dismissals** as part of the history.

If it does not work: when there is no **Revoke** button, check [Who can dismiss](#who-can-dismiss) and that the scan belongs to the organization you are working in.

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
3. In the list, click the site address of a scan of the site.
4. Click the **Issues** tab.
5. At the end of the tab, click **Dismissed findings — active: N, revoked: N** to expand it.

Result: **Active dismissals** lists the dismissals in force, under the columns **Rule**, **Element**, **Reason**, **Dismissed by** and **Dismissed on**. When at least one dismissal has been revoked, **Revoked dismissals** lists those too, with three more columns: **Revoked by**, **Revoked on** and **Comment**. The page shows the column headings in capital letters. When nothing is dismissed any more, **No active dismissals.** is shown under **Active dismissals**.

- The **Element** column, which shows the element's selector, is shown only to people whose role holds **View technical details (selectors, context)**.
- Dates and times are written in the language you use the dashboard in, and in the time zone of the server the dashboard runs on.
- A dismissal made through the API with an API key of the scan's organization names the key, for example **API key: Fabrikam CI**, followed in brackets by **Created** and the date the key was created. The date tells apart two keys with the same name, and the name is kept after the key is deleted. A key that is not one of the organization's own is shown only as **API key**.
- The section is shown only in the dashboard. The public report, share links, the print view and conformance reports never show it.

### In the audit log

Find the audit log entries that record each dismissal and each revocation.

Before you start:

- Your role holds **View audit log**. The default Owner role holds it and the default Admin role does not; global administrators hold it too.

Steps:

1. In your browser's address bar, open your dashboard's address followed by `/admin/audit-log?action=issue_dismissal.mark`, for example `https://luqen.fabrikam.example/admin/audit-log?action=issue_dismissal.mark`. The **Audit Log** page lists the dismissals that were made.
2. To list the revocations, open your dashboard's address followed by `/admin/audit-log?action=issue_dismissal.revoke` instead.
3. The newest entries come first, 50 at a time. When the list ends with **Load More**, click **Load More** to see the next ones; the same filter stays applied.

Result: each entry shows **Timestamp**, **Actor**, **Action** (`issue_dismissal.mark` or `issue_dismissal.revoke`), **Resource Type** (`issue_dismissal`), **Resource ID**, **Details**, **IP Address** and **Org**. The page shows the column headings in capital letters. **Details** holds the site address, the rule code and the selector, with the reason of a dismissal or the comment of a revocation. Unless you are a global administrator, only the entries of the organization you are working in are listed.

If it does not work: when the address does not open the page and reports that access is forbidden, your role does not hold **View audit log**; ask an Owner of your organization.

### Through the API

The dashboard's API returns every dismissal of a scan's site, active and revoked, each with its history of dismissal and revocation. Reading the list needs **View reports**. See [Issue dismissals](../reference/api-reference.md#issue-dismissals) in the API reference.

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
4. Click the **Issues** tab.
5. Find the criterion the finding is listed under, and click the criterion's title to expand it. Do not click the criterion number in front of the title: it is a link that opens the WCAG page in a new tab.
6. On the finding you want to dismiss, click **Dismiss**.
   When the same finding is listed more than once (once for each page it is on), use the **Dismiss** button of any of them: one dismissal covers them all. A finding that repeats on many pages as part of a shared component has the same **Dismiss** button on the **Templates** tab as well.
7. Check the dialog **Dismiss as false positive**: **Rule**, **Element** and **Finding** show the finding you chose. Wait until **Occurrences in this scan** and **Pages in this scan** show numbers. They count what the dismissal covers in this scan; when more than one occurrence is counted, all of them are dismissed together.
8. Type your reason in **Reason**: say why the finding is a false positive, in up to 1000 characters.
   The reason is required because it is the record of the decision. Everyone who can open the site's reports sees it next to your name, and it also appears in the Excel export and in the audit log. The hint under the box says the same: your name and the reason are shown to everyone who can view the report.
9. Click **Dismiss as false positive** at the bottom of the dialog, next to **Cancel**. The dialog's title uses the same words; the button is the one at the bottom. It stays unavailable until the counts have loaded and a reason is typed.

Result: the page reloads on the same tab and shows **Finding dismissed. Scans of this site updated: N.** The finding is no longer in the list or in the totals. At the end of the **Issues** tab, **Dismissed findings — active: N, revoked: N** appears; expand it to see the dismissal, its reason and who made it.

If it does not work: when there is no **Dismiss** button on the finding, check [Who can dismiss](#who-can-dismiss) and that the scan belongs to the organization you are working in.

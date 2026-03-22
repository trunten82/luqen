# Power BI Integration Guide

This guide walks you through connecting Luqen to Power BI Desktop to build accessibility dashboards and compliance reports.

## Overview

The Luqen Power BI connector imports data from the Luqen Data API into Power BI, giving you access to:

- **Scans** — historical scan results across all monitored sites
- **Issues** — individual accessibility violations with WCAG criterion mapping
- **Trends** — issue counts over time for trend analysis
- **Compliance** — regulatory compliance status by jurisdiction

## Prerequisites

- Power BI Desktop (Windows)
- Luqen dashboard instance with Data API access
- API key (generate one from **Settings > API Keys** in the Luqen dashboard)

## Step 1: Install the Connector

1. Download or build the `Luqen.mez` file (see the [connector README](../../powerbi-connector/README.md) for build instructions).

2. Copy `Luqen.mez` to:
   ```
   C:\Users\<YourUser>\Documents\Power BI Desktop\Custom Connectors\
   ```

3. Open Power BI Desktop and navigate to:
   **File > Options and settings > Options > Security > Data Extensions**

4. Select **Allow any extension to load without validation or warning**.

   <!-- Screenshot placeholder: Power BI Security settings showing Data Extensions option -->

5. Restart Power BI Desktop.

## Step 2: Connect to Luqen

1. Click **Home > Get Data > More...**.

   <!-- Screenshot placeholder: Get Data dialog with Luqen connector highlighted -->

2. Search for **Luqen** and select it.

3. Enter the connection details:
   - **Base URL**: Your Luqen dashboard URL (e.g. `https://luqen.example.com`)
   - **API Key**: Your API key

   <!-- Screenshot placeholder: Luqen connection dialog with Base URL and API Key fields -->

4. Click **OK**. The Navigator pane will appear with available data sources.

## Step 3: Load Data

### Scans Table

Select **Scans** in the Navigator and click **Load**. This imports all completed scan records with columns:

| Column | Type | Description |
|--------|------|-------------|
| id | Text | Unique scan identifier |
| siteUrl | Text | Scanned website URL |
| standard | Text | WCAG standard used (e.g. WCAG21AA) |
| status | Text | Scan status (completed) |
| pagesScanned | Number | Pages crawled |
| totalIssues | Number | Total issues found |
| errors | Number | Critical errors |
| warnings | Number | Warnings |
| notices | Number | Informational notices |
| confirmedViolations | Number | Confirmed regulation violations |
| createdAt | Text | Scan start timestamp |
| completedAt | Text | Scan completion timestamp |

### Compliance Summary Table

Select **Compliance Summary** for the latest compliance status per site:

| Column | Type | Description |
|--------|------|-------------|
| scanId | Text | Scan that produced this summary |
| siteUrl | Text | Website URL |
| standard | Text | WCAG standard |
| scannedAt | Text | When the scan ran |
| totalIssues | Number | Total issues |
| errors / warnings / notices | Number | Issue counts by severity |
| confirmedViolations | Number | Confirmed violations |
| jurisdictions | List | Compliance status per jurisdiction |

### Scan Issues (Function)

1. Select **Scan Issues** in the Navigator.
2. Enter a **Scan ID** (copy from the Scans table).
3. Optionally filter by **severity** (`error`, `warning`, `notice`) or **WCAG criterion** (e.g. `1.1.1`).
4. Click **Invoke** then **Load**.

### Trends (Function)

1. Select **Trends** in the Navigator.
2. Enter the **Site URL** you want trend data for.
3. Optionally set a date range.
4. Click **Invoke** then **Load**.

## Step 4: Transform Dates

The API returns dates as ISO 8601 text. Convert them in Power Query:

1. Select the `createdAt` column.
2. **Transform > Data Type > Date/Time**.
3. Repeat for `completedAt` and `scannedAt`.

Alternatively, add a calculated column in DAX:

```dax
Scan Date = DATEVALUE(LEFT(Scans[createdAt], 10))
```

## Step 5: Build Your Dashboard

### Recommended Visuals

1. **KPI Cards** — Total scans, total issues, compliance rate
2. **Line Chart** — Issues over time (from Trends data)
3. **Stacked Bar** — Errors vs warnings vs notices by site
4. **Table** — Top issues by WCAG criterion
5. **Map / Matrix** — Compliance by jurisdiction

### Example DAX Measures

#### Total Issues Across All Scans

```dax
Total Issues = SUM(Scans[totalIssues])
```

#### Error Rate (Errors as Percentage of Total Issues)

```dax
Error Rate =
DIVIDE(
    SUM(Scans[errors]),
    SUM(Scans[totalIssues]),
    0
)
```

#### Compliance Score (Percentage of Sites Passing)

```dax
Compliance Score =
DIVIDE(
    COUNTROWS(FILTER('Compliance Summary', 'Compliance Summary'[confirmedViolations] = 0)),
    COUNTROWS('Compliance Summary'),
    0
)
```

#### Month-over-Month Issue Change

```dax
MoM Issue Change =
VAR CurrentMonth = SUM(Trends[totalIssues])
VAR PreviousMonth =
    CALCULATE(
        SUM(Trends[totalIssues]),
        DATEADD(Trends[Trend Date], -1, MONTH)
    )
RETURN
    DIVIDE(CurrentMonth - PreviousMonth, PreviousMonth, 0)
```

#### Average Issues Per Page

```dax
Avg Issues Per Page =
DIVIDE(
    SUM(Scans[totalIssues]),
    SUM(Scans[pagesScanned]),
    0
)
```

#### WCAG Criterion Issue Count (Use with Scan Issues table)

```dax
Issues by Criterion =
COUNTROWS('Scan Issues')
```

#### Sites With Critical Errors

```dax
Sites With Errors =
COUNTROWS(
    FILTER(
        VALUES(Scans[siteUrl]),
        CALCULATE(SUM(Scans[errors])) > 0
    )
)
```

### Example Report Layout

```
+-----------------------------------------------------+
|  [KPI: Total Scans]  [KPI: Total Issues]  [KPI: %]  |
+-----------------------------------------------------+
|                                    |                  |
|  Line Chart: Issues Over Time      |  Donut: Severity |
|  (Trends data)                     |  Breakdown       |
|                                    |                  |
+------------------------------------+------------------+
|                                                       |
|  Table: Top 10 WCAG Violations                        |
|  Columns: Criterion | Title | Count | Severity        |
|                                                       |
+-----------------------------------------------------+
|                                                       |
|  Matrix: Compliance by Site x Jurisdiction            |
|                                                       |
+-----------------------------------------------------+
```

<!-- Screenshot placeholder: Example completed Power BI dashboard -->

## Scheduled Refresh

Power BI Desktop reports can be published to the Power BI Service. To enable scheduled refresh:

1. Publish your report to the Power BI Service.
2. Install and configure a **Personal Gateway** or **On-Premises Data Gateway**.
3. In the dataset settings, configure the Luqen data source credentials.
4. Set up a refresh schedule (e.g. daily at 6:00 AM).

Note: Custom connectors require a gateway for scheduled refresh in the Power BI Service. See [Microsoft documentation on custom connector refresh](https://learn.microsoft.com/en-us/power-bi/connect-data/service-gateway-custom-connectors).

## Troubleshooting

| Symptom | Resolution |
|---------|------------|
| Connector not listed in Get Data | Ensure `.mez` is in the Custom Connectors folder and security settings allow extensions |
| "Access Denied" or 401 error | Verify your API key is correct and has not expired |
| Empty tables | Check that your Luqen instance has completed scans |
| Slow loading | The connector paginates automatically; large datasets may take longer on first load |
| Date columns show as text | Apply the date transformation in Step 4 |
| Rate limit errors | Reduce query concurrency or contact your Luqen admin to adjust limits |

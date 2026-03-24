# Power BI Connector for Luqen

A ready-to-use Power Query M script that connects Power BI Desktop to the Luqen Data API.

> For the full custom connector (.mez) approach with navigation tables and built-in auth, see [`/powerbi-connector/`](../../powerbi-connector/).

## Prerequisites

- Power BI Desktop (any recent version)
- A running Luqen dashboard instance with the Data API enabled
- An API key — generate one from **Settings > API Keys** in the dashboard

## Quick Start

### Step 1: Open the Advanced Editor

1. Open **Power BI Desktop**.
2. Click **Get Data > Blank Query**.
3. In the Power Query Editor ribbon, click **Advanced Editor**.

### Step 2: Paste the connector script

1. Open [`luqen-connector.pq`](luqen-connector.pq) and copy its entire contents.
2. Replace everything in the Advanced Editor with the copied script.
3. Near the top of the script, update the two parameters:

```
BaseUrl = "https://your-luqen-instance.example.com",
ApiKey  = "your-api-key-here",
```

4. Click **Done**.

### Step 3: Choose which data to load

The script defines several data sources. By default it loads the **Scans** table. To load a different data source, change the `Output` line at the bottom of the script:

| Data source | Output line | Description |
|-------------|-------------|-------------|
| All scans | `Output = ScansTable` | Flat table of all completed scans |
| Compliance | `Output = ComplianceSummary` | Latest compliance status per site |
| Scan detail | `Output = ScanDetail("scan-id")` | Full detail for one scan |
| Issues | `Output = Issues("scan-id")` | All issues for one scan |
| Issues (filtered) | `Output = Issues("scan-id", "error")` | Only error-severity issues |
| Trends | `Output = Trends("https://example.com")` | Time-series data for a site |

### Step 4: Load the data

1. Click **Close & Apply** to load the table into the data model.
2. Repeat Steps 1-3 to add more queries (e.g. one for Scans, one for Trends, one for Compliance).
3. Rename each query in the Queries pane to something descriptive (e.g. "Scans", "Trends").

## Setting Up Multiple Tables

For a complete dashboard, create separate queries for each data source:

1. **Scans query** -- set `Output = ScansTable`
2. **Trends query** -- set `Output = Trends("https://your-site.com")`
3. **Compliance query** -- set `Output = ComplianceSummary`
4. **Issues query** -- set `Output = Issues("your-latest-scan-id")`

Each query uses the same script with a different `Output` line. The `BaseUrl` and `ApiKey` parameters should be the same across all queries.

**Tip:** To avoid duplicating the API key, create Power BI parameters (`BaseUrl` and `ApiKey`) and reference them in each query.

## Scheduled Refresh

To keep your Power BI dashboards up to date automatically:

1. Publish your report to the **Power BI Service** (powerbi.com).
2. Open the dataset settings in the Power BI Service.
3. Under **Data source credentials**, enter your API key:
   - Authentication method: **Anonymous** (the key is passed in the `X-API-Key` header, not as HTTP auth).
   - Privacy level: **Organizational**.
4. Under **Scheduled refresh**, enable it and set the frequency (e.g. daily or every 8 hours).
5. Click **Apply**.

The API key does not expire unless revoked from the Luqen dashboard.

**Note:** The API is rate-limited to 60 requests per minute. For large datasets, keep the refresh frequency reasonable (once per hour at most) to avoid hitting limits during pagination.

## Sample DAX Measures

After loading data, add these measures to your Power BI model for common accessibility KPIs.

### Total Errors (current)

```dax
Total Errors =
SUM(Scans[errors])
```

### Error Rate per Page

```dax
Error Rate per Page =
DIVIDE(
    SUM(Scans[errors]),
    SUM(Scans[pagesScanned]),
    0
)
```

### Compliance Pass Rate

```dax
Compliance Pass Rate =
DIVIDE(
    COUNTROWS(FILTER(ComplianceSummary, ComplianceSummary[confirmedViolations] = 0)),
    COUNTROWS(ComplianceSummary),
    0
)
```

### Issues by Severity (for a stacked bar chart)

```dax
Severity Breakdown =
UNION(
    SELECTCOLUMNS(Scans, "Severity", "Error",   "Count", Scans[errors]),
    SELECTCOLUMNS(Scans, "Severity", "Warning", "Count", Scans[warnings]),
    SELECTCOLUMNS(Scans, "Severity", "Notice",  "Count", Scans[notices])
)
```

### Month-over-Month Error Change

```dax
MoM Error Change =
VAR CurrentMonth = SUM(Trends[errors])
VAR PreviousMonth =
    CALCULATE(
        SUM(Trends[errors]),
        DATEADD(Trends[date], -1, MONTH)
    )
RETURN
    DIVIDE(CurrentMonth - PreviousMonth, PreviousMonth, 0)
```

### Accessibility Score (percentage of pages without errors)

```dax
Accessibility Score =
VAR TotalPages = SUM(Scans[pagesScanned])
VAR ErrorRate = DIVIDE(SUM(Scans[errors]), TotalPages, 0)
RETURN
    FORMAT(1 - MINIMUM(ErrorRate, 1), "0.0%")
```

## Suggested Visualizations

| Visual | Data source | Fields |
|--------|-------------|--------|
| **KPI card** | Scans | `Total Errors`, `Error Rate per Page` |
| **Line chart** | Trends | X-axis: `date`, Values: `errors`, `warnings`, `notices` |
| **Stacked bar** | Issues | X-axis: `wcagCriterion`, Values: count of rows, Legend: `type` |
| **Table** | Issues | `code`, `message`, `pageUrl`, `wcagCriterion` |
| **Gauge** | ComplianceSummary | `Compliance Pass Rate` |
| **Matrix** | ComplianceSummary | Rows: `siteUrl`, Values: `errors`, `warnings`, `confirmedViolations` |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Access to the resource is forbidden" | Verify the API key is correct and has not been revoked |
| "DataSource.Error: Web.Contents failed" | Check that `BaseUrl` is reachable from your machine |
| Empty tables | Ensure you have completed scans in the dashboard |
| Rate limit errors (HTTP 429) | Reduce scheduled refresh frequency; the API allows 60 req/min |
| Date columns show as text | Add `Table.TransformColumnTypes` for date columns, or change types in Power Query |

## API Endpoints Used

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/scans` | GET | List all completed scans (paginated) |
| `/api/v1/scans/:id` | GET | Detail for a single scan |
| `/api/v1/scans/:id/issues` | GET | Issues for a scan (with severity/criterion filters) |
| `/api/v1/trends` | GET | Time-series data for trend charts |
| `/api/v1/compliance-summary` | GET | Latest compliance status per site |

All endpoints use `X-API-Key` header authentication. See the [API Reference](../reference/api-reference.md) for full details.

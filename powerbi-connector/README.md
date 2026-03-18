# Luqen Power BI Custom Connector

A Power BI custom connector (.mez) that connects to the Luqen accessibility scanning platform's Data API.

## Data Sources

| Name | Endpoint | Type | Description |
|------|----------|------|-------------|
| **Scans** | `GET /api/v1/scans` | Table | All completed accessibility scans with pagination |
| **Scan Detail** | `GET /api/v1/scans/:id` | Function | Detailed view of a single scan including summary |
| **Scan Issues** | `GET /api/v1/scans/:id/issues` | Function | Accessibility issues for a scan, with severity/criterion filters |
| **Trends** | `GET /api/v1/trends` | Function | Historical trend data for a specific site |
| **Compliance Summary** | `GET /api/v1/compliance-summary` | Table | Latest compliance status across all monitored sites |

## Prerequisites

- Power BI Desktop (October 2023 or later recommended)
- A Luqen instance with the Data API enabled
- An API key with read access

## Building the .mez File

### Option A: PowerShell Script

```powershell
cd powerbi-connector
.\build.ps1
```

The `.mez` file will be created in `./bin/Luqen.mez`.

### Option B: Power Query SDK (Visual Studio / VS Code)

1. Install the [Power Query SDK](https://learn.microsoft.com/en-us/power-query/install-sdk) extension.
2. Open this folder in VS Code or Visual Studio.
3. Build the project — the SDK will produce `Luqen.mez` in the output directory.

### Option C: Manual ZIP

```powershell
Compress-Archive -Path "Luqen.pq","resources\Luqen.png" -DestinationPath "Luqen.mez"
```

## Installation

1. Copy `Luqen.mez` to your custom connectors folder:
   ```
   %USERPROFILE%\Documents\Power BI Desktop\Custom Connectors\
   ```
   Create the `Custom Connectors` folder if it does not exist.

2. In Power BI Desktop, go to **File > Options and settings > Options > Security**.

3. Under **Data Extensions**, select **(Not Recommended) Allow any extension to load without validation or warning**.

4. Restart Power BI Desktop.

## Connecting to Luqen

1. Open Power BI Desktop.
2. Click **Get Data > More...**.
3. Search for **Luqen** in the connector list.
4. Enter your connection parameters:
   - **Base URL**: The root URL of your Luqen dashboard (e.g. `https://luqen.example.com`)
   - **API Key**: Your Luqen API key
5. Click **OK** to connect.
6. The Navigator pane will show the available data sources (Scans, Compliance Summary, etc.).
7. Select the tables you want to import and click **Load** or **Transform Data**.

## Using Function Data Sources

Some data sources (Scan Detail, Scan Issues, Trends) are exposed as functions because they require parameters:

- **Scan Detail**: Enter a Scan ID to retrieve its details.
- **Scan Issues**: Enter a Scan ID, and optionally filter by severity (`error`, `warning`, `notice`) or WCAG criterion (e.g. `1.1.1`).
- **Trends**: Enter a Site URL, and optionally a date range.

To invoke a function, click on it in the Navigator, fill in the parameters, and click **Invoke**.

## Icon / Branding

Place a 32x32 PNG icon at `resources/Luqen.png`. The build script will generate a placeholder if no icon is present.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Connector not visible in Get Data | Verify the `.mez` is in the Custom Connectors folder and the security setting allows custom extensions |
| Authentication error (401/403) | Check that your API key is valid and has read permissions |
| "siteUrl query parameter is required" | The Trends function requires a site URL — it cannot be left blank |
| Rate limit errors (429) | The API allows 60 requests per minute — reduce refresh frequency |

## Development

Edit `Luqen.pq` and use `Luqen.query.pq` as a test harness in the Power Query SDK.

```
powerbi-connector/
  Luqen.pq           # Main connector source (Power Query M)
  Luqen.query.pq     # Test queries
  Luqen.proj          # MSBuild project for Power Query SDK
  build.ps1           # PowerShell build script
  resources/
    Luqen.png         # Connector icon (32x32 PNG)
```

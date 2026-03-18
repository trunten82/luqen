// Luqen Power BI Connector — Test Query
// Use this file to test the connector in Power Query SDK or Visual Studio.

let
    // -----------------------------------------------------------------------
    // Configuration — update these values for your environment
    // -----------------------------------------------------------------------
    baseUrl = "https://luqen.example.com",
    apiKey  = "YOUR_API_KEY_HERE",

    // -----------------------------------------------------------------------
    // Test 1: Navigation table
    // -----------------------------------------------------------------------
    nav = Luqen.Contents(baseUrl, apiKey),

    // -----------------------------------------------------------------------
    // Test 2: List all scans
    // -----------------------------------------------------------------------
    scans = nav{[Name = "Scans"]}[Data],

    // -----------------------------------------------------------------------
    // Test 3: Get detail for the first scan
    // -----------------------------------------------------------------------
    firstScanId = if Table.RowCount(scans) > 0 then scans{0}[id] else null,
    scanDetailFn = nav{[Name = "Scan Detail"]}[Data],
    scanDetail = if firstScanId <> null then scanDetailFn(firstScanId) else null,

    // -----------------------------------------------------------------------
    // Test 4: Get issues for the first scan
    // -----------------------------------------------------------------------
    scanIssuesFn = nav{[Name = "Scan Issues"]}[Data],
    scanIssues = if firstScanId <> null then scanIssuesFn(firstScanId) else null,

    // -----------------------------------------------------------------------
    // Test 5: Get issues filtered by severity
    // -----------------------------------------------------------------------
    scanErrors = if firstScanId <> null then scanIssuesFn(firstScanId, "error") else null,

    // -----------------------------------------------------------------------
    // Test 6: Get trends for a site
    // -----------------------------------------------------------------------
    trendsFn = nav{[Name = "Trends"]}[Data],
    firstSiteUrl = if Table.RowCount(scans) > 0 then scans{0}[siteUrl] else null,
    trends = if firstSiteUrl <> null then trendsFn(firstSiteUrl) else null,

    // -----------------------------------------------------------------------
    // Test 7: Compliance summary
    // -----------------------------------------------------------------------
    compliance = nav{[Name = "Compliance Summary"]}[Data],

    // -----------------------------------------------------------------------
    // Output — change this to any of the above variables to inspect results
    // -----------------------------------------------------------------------
    output = nav
in
    output

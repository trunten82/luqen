// Luqen Power Query M Connector
// Paste this script into Power BI Desktop via Get Data > Blank Query > Advanced Editor.
//
// Prerequisites:
//   1. A running Luqen dashboard instance
//   2. An API key generated from Settings > API Keys in the dashboard
//
// This script connects to the Luqen Data API and returns five tables:
//   - Scans           (GET /api/v1/scans)
//   - ScanDetail      (GET /api/v1/scans/:id)  — call with a scan ID
//   - Issues          (GET /api/v1/scans/:id/issues)  — call with a scan ID
//   - Trends          (GET /api/v1/trends)
//   - ComplianceSummary (GET /api/v1/compliance-summary)

// -------------------------------------------------------------------------
// Parameters — change these to match your environment
// -------------------------------------------------------------------------
let
    BaseUrl = "https://luqen.example.com",   // Your Luqen dashboard URL (no trailing slash)
    ApiKey  = "YOUR_API_KEY_HERE",           // API key from Settings > API Keys

    // -------------------------------------------------------------------------
    // Helper: make an authenticated GET request
    // -------------------------------------------------------------------------
    LuqenGet = (path as text) as record =>
        let
            url      = BaseUrl & path,
            response = Web.Contents(
                url,
                [
                    Headers = [
                        #"X-API-Key" = ApiKey,
                        #"Accept"    = "application/json"
                    ],
                    ManualStatusHandling = {400, 401, 403, 404, 429, 500}
                ]
            ),
            status = Value.Metadata(response)[Response.Status],
            body   = Json.Document(response),
            result = if status >= 400 then
                error Error.Record(
                    "Luqen.ApiError",
                    "HTTP " & Text.From(status)
                        & (if Record.HasFields(body, "error") then ": " & body[error] else ""),
                    [StatusCode = status, Url = url]
                )
            else
                body
        in
            result,

    // -------------------------------------------------------------------------
    // Helper: paginate through all results
    // -------------------------------------------------------------------------
    FetchAllPages = (path as text, optional extraQs as text) as list =>
        let
            pageSize  = 100,
            separator = if Text.Contains(path, "?") then "&" else "?",
            suffix    = if extraQs <> null and extraQs <> "" then "&" & extraQs else "",

            getPage = (offset as number) =>
                let
                    fullPath = path & separator & "limit=" & Text.From(pageSize)
                                    & "&offset=" & Text.From(offset) & suffix,
                    page     = LuqenGet(fullPath)
                in
                    page,

            firstPage = getPage(0),
            firstData = firstPage[data],
            total     = if Record.HasFields(firstPage, "total") then firstPage[total]
                        else List.Count(firstData),

            remainingOffsets = List.Generate(
                () => pageSize,
                each _ < total,
                each _ + pageSize
            ),
            remainingData = List.Combine(
                List.Transform(remainingOffsets, each getPage(_)[data])
            ),
            allData = List.Combine({firstData, remainingData})
        in
            allData,

    // =====================================================================
    // 1. Scans — flat table of all completed scans
    // =====================================================================
    RawScans  = FetchAllPages("/api/v1/scans"),
    ScansTable = if List.Count(RawScans) = 0 then
        #table(
            {"id","siteUrl","scanMode","status","standard","pagesScanned",
             "totalIssues","errors","warnings","notices","createdAt","completedAt"},
            {}
        )
    else
        let
            tbl   = Table.FromRecords(RawScans, null, MissingField.UseNull),
            typed = Table.TransformColumnTypes(tbl, {
                {"pagesScanned", Int64.Type},
                {"totalIssues",  Int64.Type},
                {"errors",       Int64.Type},
                {"warnings",     Int64.Type},
                {"notices",      Int64.Type},
                {"createdAt",    type datetimezone},
                {"completedAt",  type datetimezone}
            })
        in
            typed,

    // =====================================================================
    // 2. Scan Detail — returns detail for a single scan ID
    //    Usage: call ScanDetail("your-scan-id")
    // =====================================================================
    ScanDetail = (scanId as text) as table =>
        let
            result   = LuqenGet("/api/v1/scans/" & Uri.EscapeDataString(scanId)),
            data     = result[data],
            asTable  = Table.FromRecords({data}, null, MissingField.UseNull)
        in
            asTable,

    // =====================================================================
    // 3. Issues — returns all issues for a scan, flattened
    //    Usage: call Issues("your-scan-id")
    //    Optional: Issues("your-scan-id", "error") to filter by severity
    // =====================================================================
    Issues = (scanId as text, optional severity as text) as table =>
        let
            basePath = "/api/v1/scans/" & Uri.EscapeDataString(scanId) & "/issues",
            qs       = if severity <> null and severity <> "" then "severity=" & severity else "",
            rows     = FetchAllPages(basePath, qs),
            asTable  = if List.Count(rows) = 0 then
                #table(
                    {"type","code","message","selector","wcagCriterion","wcagTitle","pageUrl"},
                    {}
                )
            else
                let
                    tbl = Table.FromRecords(rows, null, MissingField.UseNull),
                    // Expand the regulations list into a semicolon-separated string
                    // so each row stays flat and usable in Power BI visuals
                    withRegs = if Table.HasColumns(tbl, "regulations") then
                        Table.TransformColumns(tbl, {
                            {"regulations", each
                                if _ is list then
                                    Text.Combine(
                                        List.Transform(_, each
                                            (if Record.HasFields(_, "shortName") then _[shortName] else "")
                                            & (if Record.HasFields(_, "obligation") then " (" & _[obligation] & ")" else "")
                                        ),
                                        "; "
                                    )
                                else ""
                            }
                        })
                    else
                        tbl
                in
                    withRegs
        in
            asTable,

    // =====================================================================
    // 4. Trends — time-series data for a given site URL
    //    Usage: call Trends("https://example.com")
    // =====================================================================
    Trends = (siteUrl as text, optional fromDate as text, optional toDate as text) as table =>
        let
            qs = "siteUrl=" & Uri.EscapeDataString(siteUrl)
                & (if fromDate <> null and fromDate <> "" then "&from=" & fromDate else "")
                & (if toDate <> null and toDate <> "" then "&to=" & toDate else ""),
            result  = LuqenGet("/api/v1/trends?" & qs),
            data    = result[data],
            asTable = if List.Count(data) = 0 then
                #table({"date","pagesScanned","totalIssues","errors","warnings","notices"}, {})
            else
                let
                    tbl   = Table.FromRecords(data, null, MissingField.UseNull),
                    typed = Table.TransformColumnTypes(tbl, {
                        {"pagesScanned", Int64.Type},
                        {"totalIssues",  Int64.Type},
                        {"errors",       Int64.Type},
                        {"warnings",     Int64.Type},
                        {"notices",      Int64.Type}
                    })
                in
                    typed
        in
            asTable,

    // =====================================================================
    // 5. Compliance Summary — latest compliance status per site
    // =====================================================================
    RawCompliance  = LuqenGet("/api/v1/compliance-summary"),
    ComplianceData = RawCompliance[data],
    ComplianceSummary = if List.Count(ComplianceData) = 0 then
        #table(
            {"scanId","siteUrl","standard","scannedAt","totalIssues",
             "errors","warnings","notices","confirmedViolations"},
            {}
        )
    else
        let
            tbl   = Table.FromRecords(ComplianceData, null, MissingField.UseNull),
            typed = Table.TransformColumnTypes(tbl, {
                {"totalIssues",          Int64.Type},
                {"errors",               Int64.Type},
                {"warnings",             Int64.Type},
                {"notices",              Int64.Type},
                {"confirmedViolations",  Int64.Type}
            })
        in
            typed,

    // =====================================================================
    // Output — change this line to select which table to load
    // =====================================================================
    // To load scans:              replace Output with ScansTable
    // To load compliance:         replace Output with ComplianceSummary
    // To load scan detail:        replace Output with ScanDetail("scan-id-here")
    // To load issues:             replace Output with Issues("scan-id-here")
    // To load issues (errors):    replace Output with Issues("scan-id-here", "error")
    // To load trends:             replace Output with Trends("https://example.com")
    Output = ScansTable
in
    Output

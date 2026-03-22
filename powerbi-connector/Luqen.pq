// Luqen Power BI Custom Connector
// Wraps the Luqen Dashboard Data API for accessibility analytics in Power BI.
//
// Data sources exposed via the navigation table:
//   - Scans           GET /api/v1/scans
//   - Scan Detail     GET /api/v1/scans/:id
//   - Scan Issues     GET /api/v1/scans/:id/issues
//   - Trends          GET /api/v1/trends
//   - Compliance Summary  GET /api/v1/compliance-summary

section Luqen;

// ---------------------------------------------------------------------------
// Connector metadata
// ---------------------------------------------------------------------------

[DataSource.Kind = "Luqen", Publish = "Luqen.Publish"]
shared Luqen.Contents = Value.ReplaceType(
    LuqenImpl,
    LuqenType
);

LuqenType = type function (
    baseUrl as (type text meta [
        Documentation.FieldCaption = "Base URL",
        Documentation.FieldDescription = "Root URL of the Luqen dashboard (e.g. https://luqen.example.com)",
        Documentation.SampleValues = {"https://luqen.example.com"}
    ]),
    apiKey as (type text meta [
        Documentation.FieldCaption = "API Key",
        Documentation.FieldDescription = "API key for authentication (sent as X-API-Key header)"
    ])
) as table meta [
    Documentation.Name = "Luqen",
    Documentation.LongDescription = "Connect to the Luqen accessibility scanning platform to import scans, issues, trends, and compliance data into Power BI."
];

// ---------------------------------------------------------------------------
// Main entry point — returns a navigation table
// ---------------------------------------------------------------------------

LuqenImpl = (baseUrl as text, apiKey as text) as table =>
    let
        cleanUrl = Text.TrimEnd(baseUrl, "/"),
        navTable = #table(
            {"Name", "Data", "ItemKind", "ItemName", "IsLeaf"},
            {
                {"Scans",               Luqen.Scans(cleanUrl, apiKey),              "Table", "Table", true},
                {"Scan Detail",         Luqen.ScanDetailFunc(cleanUrl, apiKey),      "Function", "Function", true},
                {"Scan Issues",         Luqen.ScanIssuesFunc(cleanUrl, apiKey),      "Function", "Function", true},
                {"Trends",              Luqen.TrendsFunc(cleanUrl, apiKey),          "Function", "Function", true},
                {"Compliance Summary",  Luqen.ComplianceSummary(cleanUrl, apiKey),   "Table", "Table", true}
            }
        ),
        typed = Table.ForceToNavigationTable(navTable)
    in
        typed;

// ---------------------------------------------------------------------------
// Helper: force a table into the Power BI navigation-table shape
// ---------------------------------------------------------------------------

Table.ForceToNavigationTable = (table as table) as table =>
    let
        keys = {"Name"},
        withKeys = Table.AddKey(table, keys, true),
        withItemKind = Value.ReplaceType(
            withKeys,
            Value.Type(withKeys) meta [
                NavigationTable.NameColumn = "Name",
                NavigationTable.DataColumn = "Data",
                NavigationTable.ItemKindColumn = "ItemKind",
                Preview.DelayColumn = "Data"
            ]
        )
    in
        withItemKind;

// ---------------------------------------------------------------------------
// API request helpers
// ---------------------------------------------------------------------------

Luqen.ApiRequest = (url as text, apiKey as text) as record =>
    let
        response = Web.Contents(
            url,
            [
                Headers = [
                    #"X-API-Key" = apiKey,
                    #"Accept" = "application/json"
                ],
                ManualStatusHandling = {400, 401, 403, 404, 500}
            ]
        ),
        statusCode = Value.Metadata(response)[Response.Status],
        body = Json.Document(response),
        result = if statusCode >= 400 then
            error Error.Record(
                "Luqen.ApiError",
                "API request failed with status " & Text.From(statusCode)
                    & (if Record.HasFields(body, "error") then ": " & body[error] else ""),
                [StatusCode = statusCode, Url = url]
            )
        else
            body
    in
        result;

Luqen.ApiRequestWithParams = (baseUrl as text, path as text, apiKey as text, queryParams as record) as record =>
    let
        // Build query string from non-null params
        fields = Record.FieldNames(queryParams),
        nonNull = List.Select(fields, each Record.Field(queryParams, _) <> null and Record.Field(queryParams, _) <> ""),
        pairs = List.Transform(nonNull, each _ & "=" & Uri.EscapeDataString(Text.From(Record.Field(queryParams, _)))),
        qs = if List.Count(pairs) > 0 then "?" & Text.Combine(pairs, "&") else "",
        fullUrl = baseUrl & path & qs,
        result = Luqen.ApiRequest(fullUrl, apiKey)
    in
        result;

// ---------------------------------------------------------------------------
// GET /api/v1/scans
// ---------------------------------------------------------------------------

ScansType = type table [
    id = text,
    siteUrl = text,
    standard = text,
    status = text,
    pagesScanned = nullable Int64.Type,
    totalIssues = nullable Int64.Type,
    errors = nullable Int64.Type,
    warnings = nullable Int64.Type,
    notices = nullable Int64.Type,
    confirmedViolations = nullable Int64.Type,
    createdAt = text,
    completedAt = nullable text
];

Luqen.Scans = (baseUrl as text, apiKey as text) as table =>
    let
        allRows = Luqen.FetchAllPages(baseUrl, "/api/v1/scans", apiKey, []),
        asTable = if List.Count(allRows) = 0 then
            #table(
                {"id","siteUrl","standard","status","pagesScanned","totalIssues",
                 "errors","warnings","notices","confirmedViolations","createdAt","completedAt"},
                {}
            )
        else
            Table.FromRecords(allRows, null, MissingField.UseNull),
        typed = Value.ReplaceType(asTable, ScansType)
    in
        typed;

// ---------------------------------------------------------------------------
// GET /api/v1/scans/:id  (function — user provides scan ID)
// ---------------------------------------------------------------------------

ScanDetailType = type table [
    id = text,
    siteUrl = text,
    standard = text,
    status = text,
    pagesScanned = nullable Int64.Type,
    totalIssues = nullable Int64.Type,
    errors = nullable Int64.Type,
    warnings = nullable Int64.Type,
    notices = nullable Int64.Type,
    confirmedViolations = nullable Int64.Type,
    createdAt = text,
    completedAt = nullable text,
    summary = nullable record
];

Luqen.ScanDetailFunc = (baseUrl as text, apiKey as text) =>
    let
        fn = (scanId as text) as table =>
            let
                result = Luqen.ApiRequest(baseUrl & "/api/v1/scans/" & Uri.EscapeDataString(scanId), apiKey),
                data = result[data],
                asTable = Table.FromRecords({data}, null, MissingField.UseNull),
                typed = Value.ReplaceType(asTable, ScanDetailType)
            in
                typed,
        typedFn = Value.ReplaceType(
            fn,
            type function (scanId as (type text meta [
                Documentation.FieldCaption = "Scan ID",
                Documentation.FieldDescription = "Unique identifier of the scan to retrieve"
            ])) as table meta [
                Documentation.Name = "Luqen.ScanDetail",
                Documentation.LongDescription = "Retrieves detailed information for a single scan including its summary."
            ]
        )
    in
        typedFn;

// ---------------------------------------------------------------------------
// GET /api/v1/scans/:id/issues  (function — user provides scan ID)
// ---------------------------------------------------------------------------

ScanIssuesType = type table [
    #"type" = text,
    code = text,
    message = text,
    selector = text,
    wcagCriterion = nullable text,
    wcagTitle = nullable text,
    pageUrl = text,
    regulations = list
];

Luqen.ScanIssuesFunc = (baseUrl as text, apiKey as text) =>
    let
        fn = (scanId as text, optional severity as text, optional criterion as text) as table =>
            let
                params = [severity = severity ?? "", criterion = criterion ?? ""],
                allRows = Luqen.FetchAllPages(
                    baseUrl,
                    "/api/v1/scans/" & Uri.EscapeDataString(scanId) & "/issues",
                    apiKey,
                    params
                ),
                asTable = if List.Count(allRows) = 0 then
                    #table({"type","code","message","selector","wcagCriterion","wcagTitle","pageUrl","regulations"}, {})
                else
                    Table.FromRecords(allRows, null, MissingField.UseNull),
                typed = Value.ReplaceType(asTable, ScanIssuesType)
            in
                typed,
        typedFn = Value.ReplaceType(
            fn,
            type function (
                scanId as (type text meta [
                    Documentation.FieldCaption = "Scan ID",
                    Documentation.FieldDescription = "Unique identifier of the scan"
                ]),
                optional severity as (type text meta [
                    Documentation.FieldCaption = "Severity Filter",
                    Documentation.FieldDescription = "Filter by severity: error, warning, or notice",
                    Documentation.AllowedValues = {"error", "warning", "notice"}
                ]),
                optional criterion as (type text meta [
                    Documentation.FieldCaption = "WCAG Criterion Filter",
                    Documentation.FieldDescription = "Filter by WCAG criterion (e.g. 1.1.1)"
                ])
            ) as table meta [
                Documentation.Name = "Luqen.ScanIssues",
                Documentation.LongDescription = "Retrieves all accessibility issues for a given scan, with optional severity and WCAG criterion filters."
            ]
        )
    in
        typedFn;

// ---------------------------------------------------------------------------
// GET /api/v1/trends  (function — siteUrl is required)
// ---------------------------------------------------------------------------

TrendsType = type table [
    date = text,
    pagesScanned = Int64.Type,
    totalIssues = Int64.Type,
    errors = Int64.Type,
    warnings = Int64.Type,
    notices = Int64.Type,
    confirmedViolations = Int64.Type
];

Luqen.TrendsFunc = (baseUrl as text, apiKey as text) =>
    let
        fn = (siteUrl as text, optional fromDate as text, optional toDate as text) as table =>
            let
                params = [siteUrl = siteUrl, from = fromDate ?? "", to = toDate ?? ""],
                result = Luqen.ApiRequestWithParams(baseUrl, "/api/v1/trends", apiKey, params),
                data = result[data],
                asTable = if List.Count(data) = 0 then
                    #table({"date","pagesScanned","totalIssues","errors","warnings","notices","confirmedViolations"}, {})
                else
                    Table.FromRecords(data, null, MissingField.UseNull),
                typed = Value.ReplaceType(asTable, TrendsType)
            in
                typed,
        typedFn = Value.ReplaceType(
            fn,
            type function (
                siteUrl as (type text meta [
                    Documentation.FieldCaption = "Site URL",
                    Documentation.FieldDescription = "The website URL to get trend data for",
                    Documentation.SampleValues = {"https://example.com"}
                ]),
                optional fromDate as (type text meta [
                    Documentation.FieldCaption = "From Date",
                    Documentation.FieldDescription = "Start date in ISO format (e.g. 2025-01-01)"
                ]),
                optional toDate as (type text meta [
                    Documentation.FieldCaption = "To Date",
                    Documentation.FieldDescription = "End date in ISO format (e.g. 2025-12-31)"
                ])
            ) as table meta [
                Documentation.Name = "Luqen.Trends",
                Documentation.LongDescription = "Retrieves accessibility trend data over time for a specific site."
            ]
        )
    in
        typedFn;

// ---------------------------------------------------------------------------
// GET /api/v1/compliance-summary
// ---------------------------------------------------------------------------

ComplianceSummaryType = type table [
    scanId = text,
    siteUrl = text,
    standard = text,
    scannedAt = text,
    totalIssues = Int64.Type,
    errors = Int64.Type,
    warnings = Int64.Type,
    notices = Int64.Type,
    confirmedViolations = Int64.Type,
    jurisdictions = list
];

Luqen.ComplianceSummary = (baseUrl as text, apiKey as text) as table =>
    let
        result = Luqen.ApiRequestWithParams(baseUrl, "/api/v1/compliance-summary", apiKey, []),
        data = result[data],
        asTable = if List.Count(data) = 0 then
            #table(
                {"scanId","siteUrl","standard","scannedAt","totalIssues",
                 "errors","warnings","notices","confirmedViolations","jurisdictions"},
                {}
            )
        else
            Table.FromRecords(data, null, MissingField.UseNull),
        typed = Value.ReplaceType(asTable, ComplianceSummaryType)
    in
        typed;

// ---------------------------------------------------------------------------
// Pagination helper — fetches all pages of a paginated endpoint
// ---------------------------------------------------------------------------

Luqen.FetchAllPages = (baseUrl as text, path as text, apiKey as text, extraParams as record) as list =>
    let
        pageSize = 100,
        fetchPage = (offset as number) =>
            let
                params = Record.Combine({extraParams, [limit = Text.From(pageSize), offset = Text.From(offset)]}),
                result = Luqen.ApiRequestWithParams(baseUrl, path, apiKey, params)
            in
                result,
        firstPage = fetchPage(0),
        total = if Record.HasFields(firstPage, "total") then firstPage[total] else List.Count(firstPage[data]),
        firstData = firstPage[data],
        remainingOffsets = List.Generate(
            () => pageSize,
            each _ < total,
            each _ + pageSize
        ),
        remainingPages = List.Transform(remainingOffsets, each fetchPage(_)[data]),
        allData = List.Combine(List.Combine({{firstData}, remainingPages}))
    in
        allData;

// ---------------------------------------------------------------------------
// Authentication kind — API Key via custom header
// ---------------------------------------------------------------------------

Luqen = [
    Authentication = [
        Key = [
            KeyLabel = "API Key",
            Label = "Luqen API Key"
        ]
    ],
    Label = "Luqen Accessibility Platform"
];

// ---------------------------------------------------------------------------
// Publish metadata (icon, button text, etc.)
// ---------------------------------------------------------------------------

Luqen.Publish = [
    Beta = true,
    Category = "Other",
    ButtonText = {Extension.LoadString("ButtonTitle"), Extension.LoadString("ButtonHelp")},
    LearnMoreUrl = "https://docs.luqen.dev/integrations/powerbi",
    SourceImage = Luqen.Icons,
    SourceTypeImage = Luqen.Icons
];

Luqen.Icons = [
    Icon16 = {Extension.Contents("resources/Luqen.png"), Extension.Contents("resources/Luqen.png"), Extension.Contents("resources/Luqen.png"), Extension.Contents("resources/Luqen.png")},
    Icon32 = {Extension.Contents("resources/Luqen.png"), Extension.Contents("resources/Luqen.png"), Extension.Contents("resources/Luqen.png"), Extension.Contents("resources/Luqen.png")}
];

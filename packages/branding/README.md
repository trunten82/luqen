# @luqen/branding

Brand guideline matching for accessibility findings. Define your organisation's brand assets (colours, fonts, CSS selectors) and classify scan issues as **Brand-Related** or **Unexpected**.

## Installation

```bash
npm install @luqen/branding
```

## Quick Start

```typescript
import { BrandingMatcher, GuidelineStore } from '@luqen/branding';
import type { BrandGuideline, MatchableIssue } from '@luqen/branding';

// 1. Define a brand guideline
const guideline: BrandGuideline = {
  id: 'aperol-brand',
  orgId: 'campari-group',
  name: 'Aperol Brand Guide',
  version: 1,
  active: true,
  colors: [
    { id: 'c1', name: 'Aperol Orange', hexValue: '#FF5722', usage: 'primary' },
    { id: 'c2', name: 'White', hexValue: '#FFFFFF', usage: 'background' },
  ],
  fonts: [
    { id: 'f1', family: 'Montserrat', weights: ['400', '700'], usage: 'heading' },
  ],
  selectors: [
    { id: 's1', pattern: '.brand-*', description: 'All brand-prefixed elements' },
  ],
};

// 2. Match accessibility issues against the guideline
const matcher = new BrandingMatcher();
const results = matcher.match(issues, guideline);

for (const { issue, brandMatch } of results) {
  if (brandMatch.matched) {
    console.log(`${issue.code}: Brand-Related (${brandMatch.strategy}) — ${brandMatch.matchDetail}`);
  } else {
    console.log(`${issue.code}: Unexpected`);
  }
}
```

## Matching Strategies

The matcher applies three strategies in order. First match wins.

### 1. Color-Pair Matching

Extracts foreground and background colours from issue HTML context and compares against the brand palette. Only applies to contrast-related WCAG codes (1.4.3, 1.4.6, 1.4.11).

### 2. Font Matching

Extracts `font-family` from issue context CSS and compares case-insensitively against brand font definitions.

### 3. Selector Rules

Matches the issue's CSS selector against user-defined patterns with wildcard support (`*` becomes `.*`).

## GuidelineStore

In-memory store for managing guidelines and site assignments. Implements `IBrandingStore`.

```typescript
const store = new GuidelineStore();
store.addGuideline(guideline);
store.assignToSite('aperol-brand', 'https://aperol.com', 'campari-group');

// Resolve guideline for a site
const resolved = store.getGuidelineForSite('https://aperol.com', 'campari-group');

// Or use the convenience method
const results = matcher.matchForSite(issues, 'https://aperol.com', 'campari-group', store);
```

### Custom Storage Backends

Implement `IBrandingStore` for database-backed storage:

```typescript
import type { IBrandingStore } from '@luqen/branding';

class MyDatabaseStore implements IBrandingStore {
  // Implement all methods...
}
```

## GuidelineParser

Parse brand guidelines from CSV, JSON, or PDF (with LLM plugin).

### CSV Template

```typescript
import { GuidelineParser } from '@luqen/branding';

// Download template
const csvTemplate = GuidelineParser.generateCSVTemplate();

// Parse filled template
const parser = new GuidelineParser();
const data = await parser.parseCSV(csvContent);
// → { colors: [...], fonts: [...], selectors: [...] }
```

CSV format: `type,name,value,usage,context`

| type | name | value | usage | context |
|------|------|-------|-------|---------|
| color | Aperol Orange | #FF5722 | primary | Hero sections |
| font | Montserrat | 400;700 | heading | H1, H2 |
| selector | .brand-header | | | Navigation |

### JSON Template

```typescript
const jsonTemplate = GuidelineParser.generateJSONTemplate();
const data = await parser.parseJSON(jsonContent);
```

### PDF Parsing (requires LLM plugin)

```typescript
import type { IBrandingLLMProvider } from '@luqen/branding';

const myProvider: IBrandingLLMProvider = {
  async extractBrandData(text) {
    // Call your LLM to extract brand data from text
    return { colors: [...], fonts: [...] };
  },
};

const data = await parser.parsePDF(pdfText, { llmProvider: myProvider });
```

## Types

### Core Types

| Type | Description |
|------|-------------|
| `BrandGuideline` | Complete guideline with colours, fonts, selectors |
| `BrandColor` | Colour definition (id, name, hexValue, usage, context) |
| `BrandFont` | Font definition (id, family, weights, usage, context) |
| `BrandSelector` | CSS selector pattern (id, pattern, description) |
| `BrandMatch` | Successful match result with strategy and detail |
| `BrandMatchResult` | `BrandMatch \| NoBrandMatch` discriminated union |
| `MatchableIssue` | Minimum issue shape the matcher accepts |
| `BrandedIssue<T>` | Issue paired with its match result |

### Interfaces

| Interface | Description |
|-----------|-------------|
| `IBrandingStore` | Storage backend contract (CRUD + site assignments) |
| `IBrandingLLMProvider` | LLM extraction contract for PDF parsing |

## Colour Utilities

```typescript
import { normalizeHex, extractColorsFromContext } from '@luqen/branding';

normalizeHex('#ff5722');  // '#FF5722'
normalizeHex('abc');      // '#AABBCC'

extractColorsFromContext('<span style="color: #FF5722; background: rgb(255,255,255);">');
// ['#FF5722', '#FFFFFF']
```

## License

MIT

# External Data Sources — Compliance Service

The Luqen compliance service fetches regulatory and WCAG criteria data from the following external sources at runtime. All sources are used under permissive licenses compatible with MIT distribution. No external data is bundled — it is fetched on schedule and changes require admin approval.

## Sources

### W3C WAI Policies Prototype
- **Repository:** https://github.com/w3c/wai-policies-prototype
- **Live site:** https://www.w3.org/WAI/policies/
- **License:** W3C Software License (permissive, attribution required)
- **Data:** Accessibility policy metadata for ~47 countries in YAML format
- **Fields:** Regulation name, WCAG version referenced, enforcement date, scope, type
- **Usage:** Primary source for regulation metadata. Parsed on weekly schedule to detect regulatory changes. Changes create proposals for admin review.
- **Coverage:** Argentina, Australia, Austria, Belgium, Brazil, Canada, China, Colombia, EU, France, Germany, Hong Kong, India, Ireland, Israel, Italy, Japan, Korea, Netherlands, New Zealand, Norway, Russia, Spain, Sweden, Switzerland, Taiwan, UK, US, and more.

### W3C WCAG Quick Reference
- **Repository:** https://github.com/w3c/wai-wcag-quickref
- **Raw data:** https://raw.githubusercontent.com/w3c/wai-wcag-quickref/gh-pages/_data/wcag21.json
- **License:** W3C Software License
- **Data:** All WCAG 2.0 and 2.1 success criteria with metadata
- **Fields:** Criterion number, level (A/AA/AAA), title, versions, techniques
- **Usage:** Upstream source for WCAG criteria reference data. Synced monthly.

### tenon-io/wcag-as-json
- **Repository:** https://github.com/tenon-io/wcag-as-json
- **npm:** wcag-as-json
- **License:** MIT
- **Data:** WCAG 2.2 success criteria with JSON Schema
- **Fields:** Criterion ID, title, level, description, special cases, references
- **Usage:** Upstream source for WCAG 2.2 criteria data. Synced monthly.

## How Data Is Used

1. **Monitored sources** fetch content on schedule (weekly for policies, monthly for WCAG data)
2. Content changes are detected via SHA-256 hashing
3. Changed content is parsed by category-specific parsers:
   - W3C YAML → rule-based extraction of regulation metadata
   - WCAG JSON → structured criteria extraction
   - Government pages → LLM-based extraction (when configured)
4. Parsed data is compared against the current database
5. Differences are created as **proposals** with a trust level:
   - `w3c-policy` and `wcag-upstream` sources produce **certified** proposals (auto-acknowledged)
   - `government` and `generic` sources produce **extracted** proposals (require human review)
6. Certified proposals from structured authoritative sources are treated as factual; extracted proposals from LLM-parsed content need manual verification

## Attribution

This software uses accessibility policy data from the **W3C Web Accessibility Initiative (WAI)** and WCAG criteria data from the **W3C** and **tenon-io** open source projects.

- W3C content is used under the W3C Software License: https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document
- tenon-io/wcag-as-json is used under the MIT License

## License Compatibility

All external sources use permissive licenses compatible with Luqen's MIT license:
- **W3C Software License** — allows use, modification, and redistribution with attribution
- **MIT License** — allows use, modification, and redistribution with attribution

Luqen fetches data at runtime (not bundled), making license compliance straightforward.

# Reference-set image licences

Manifest of every third-party image byte committed under
`packages/llm/tests/eval/images/`. This repo is PUBLIC — an image set is a
licensing question before it is a technical one (OR-2, Phase 83 CONTEXT). No
image from `w3c/wai-tutorial-images` (e.g. `dog.jpg`, `family.jpg`,
`peafowl.jpg`, `chart.png`) is present here: that repo's redistribution rights
are undocumented, and undocumented is treated exactly as a refusal.

Every row below was verified via the Wikimedia Commons `imageinfo` /
`extmetadata` API — never inferred from a page's appearance, a repository's
reputation, or the absence of a restriction.

| Asset file | Item id | Licence id | Licence name | Commons file page | Bytes URL | Author | Retrieved | Bytes |
|---|---|---|---|---|---|---|---|---|
| `images/img-informative-seed.jpg` | `img-informative-seed` | `cc-by-3.0` | Creative Commons Attribution 3.0 | https://commons.wikimedia.org/wiki/File:Callie_the_golden_retriever_puppy.jpg | https://thumb.wikimedia.org/wikipedia/commons/thumb/3/33/Callie_the_golden_retriever_puppy.jpg/960px-Callie_the_golden_retriever_puppy.jpg | MichaelMcPhee | 2026-09-05T09:22:25.000Z | 193795 |

## Verification method

For each row, the licence was read from:

```
curl -sfL 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata|url&titles=File:<NAME>'
```

The `img-informative-seed` row's API response returned
`LicenseShortName: "CC BY 3.0"`, `LicenseUrl:
https://creativecommons.org/licenses/by/3.0`, `AttributionRequired: true`,
`Artist: MichaelMcPhee` — a permissive, redistributable licence with
attribution, per the plan's acceptance criteria (CC0, public domain, or
CC-BY / CC-BY-SA with attribution).

**Note on derivative size:** the plan calls for downloading the ~800px-wide
thumbnail derivative. Requesting `iiurlwidth=800` via the API, and
constructing the `800px-...` thumbnail URL directly, both returned the same
960×720 / 193KB derivative from this host — the Commons thumbnail CDN served
its nearest cached bucket rather than generating a fresh 800px render (a
600px request returned `HTTP 400` from the same edge node). 193KB is still a
small fraction of the 1.5MB / 2048×1536 original and needed no local image
processing, which is the property the ~800px guidance was protecting; this is
recorded rather than silently rounded to "800px" in the metadata above.

Plan 83-03 appends its own rows to this manifest as it adds the remaining
image-alt categories (complex, decorative, functional).

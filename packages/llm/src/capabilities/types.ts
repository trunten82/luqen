export class CapabilityExhaustedError extends Error {
  constructor(
    public readonly capability: string,
    public readonly attempts: number,
    public readonly lastError?: Error,
  ) {
    super(`All models exhausted for capability "${capability}" after ${attempts} attempts`);
    this.name = 'CapabilityExhaustedError';
  }
}

export class CapabilityNotConfiguredError extends Error {
  constructor(public readonly capability: string) {
    super(`No model configured for capability "${capability}"`);
    this.name = 'CapabilityNotConfiguredError';
  }
}

export interface CapabilityResult<T> {
  readonly data: T;
  readonly model: string;
  readonly provider: string;
  readonly attempts: number;
  /**
   * HARNESS-06: the raw, unparsed model response text, exactly as returned
   * by the adapter's `complete()`. Populated by executeGenerateFix and
   * executeAnalyseVisual from `result.text`, before either parser runs.
   *
   * Why this exists: the parsed `data` field alone cannot distinguish a
   * genuine model verdict from a parser-manufactured one. At
   * analyse-visual.ts:51-53, a response that parses cleanly but carries no
   * `verdict` and no `findings` silently becomes `'pass'` — indistinguishable
   * at the parsed layer from a real, considered pass. At :66, a response
   * that fails to parse at all becomes `'uncertain'` — also indistinguishable
   * from other paths that could produce the same default. Only the raw text
   * separates these states.
   *
   * Placement is deliberate and load-bearing, not stylistic: this field is a
   * SIBLING of `data`, never nested inside it. Every current consumer
   * (capabilities-exec.ts, mcp/server.ts) builds its outbound payload by
   * spreading `capResult.data` and naming `model`/`provider`/`attempts`
   * explicitly — none of them spreads the whole `capResult`. A field here is
   * therefore unreachable from any existing HTTP/MCP serialisation site by
   * construction. Do not add a code path that spreads `capResult` itself.
   */
  readonly rawText?: string;
}

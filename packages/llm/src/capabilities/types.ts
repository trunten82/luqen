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
}

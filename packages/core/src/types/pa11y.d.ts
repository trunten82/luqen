declare module 'pa11y' {
  interface Pa11yOptions {
    standard?: string;
    timeout?: number;
    wait?: number;
    hideElements?: string;
    headers?: Record<string, string>;
    runners?: string[];
    chromeLaunchConfig?: {
      args?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  interface Pa11yIssue {
    code: string;
    type: string;
    message: string;
    selector: string;
    context: string;
    runner?: string;
    [key: string]: unknown;
  }

  interface Pa11yResult {
    pageUrl: string;
    issues: Pa11yIssue[];
    [key: string]: unknown;
  }

  function pa11y(url: string, options?: Pa11yOptions): Promise<Pa11yResult>;

  export default pa11y;
}

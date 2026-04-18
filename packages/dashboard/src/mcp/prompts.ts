/**
 * registerPrompts — Dashboard MCP Prompts (Phase 30 plan 30-05).
 *
 * Plan 30-05 replaces the stub below with /scan, /report, /fix prompt
 * registrations (MCPI-06). Each prompt returns a chat-message template
 * (system + user messages with placeholders) — NOT tool-call pre-fills
 * — per 29-CONTEXT.md D-12.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerPrompts(_server: McpServer): void {
  // Plan 30-05 populates this with /scan /report /fix prompts whose
  // argsSchema is a zod raw shape (the SDK auto-converts to the MCP
  // wire format `{name, description, required}` per D-14).
}

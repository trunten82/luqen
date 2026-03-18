import type { AccessibilityIssue } from '../types.js';

interface FixSuggestion {
  readonly description: string;
  readonly oldText: string;
  readonly newText: string;
}

type FixRule = (issue: AccessibilityIssue) => FixSuggestion | null;

const imgMissingAlt: FixRule = (issue) => {
  if (!issue.code.includes('H37') && !issue.message.toLowerCase().includes('alt')) return null;
  if (!issue.context.includes('<img')) return null;
  const oldText = issue.context;
  const newText = oldText.replace(/<img(\s)/, '<img alt=""$1');
  if (newText === oldText) {
    return { description: 'Add alt="" attribute to image', oldText, newText: oldText.replace(/<img/, '<img alt=""') };
  }
  return { description: 'Add alt="" attribute to image', oldText, newText };
};

const inputMissingLabel: FixRule = (issue) => {
  if (!issue.code.includes('H44') && !issue.message.toLowerCase().includes('label')) return null;
  if (!issue.context.includes('<input')) return null;
  const nameMatch = issue.context.match(/name="([^"]*)"/);
  const label = nameMatch ? nameMatch[1] : 'input field';
  return { description: `Add aria-label="${label}" to input`, oldText: issue.context, newText: issue.context.replace(/<input/, `<input aria-label="${label}"`) };
};

const htmlMissingLang: FixRule = (issue) => {
  if (!issue.code.includes('H57') && !issue.code.includes('3_1_1')) return null;
  if (!issue.context.includes('<html')) return null;
  return { description: 'Add lang="en" to <html>', oldText: issue.context, newText: issue.context.replace(/<html/, '<html lang="en"') };
};

const FIX_RULES: readonly FixRule[] = [imgMissingAlt, inputMissingLabel, htmlMissingLang];

export function getFixForIssue(issue: AccessibilityIssue): FixSuggestion | null {
  for (const rule of FIX_RULES) {
    const fix = rule(issue);
    if (fix) return fix;
  }
  return null;
}

import { readFile, writeFile } from 'node:fs/promises';
import type { FixProposal, FixResult } from '../types.js';

function generateUnifiedDiff(filePath: string, originalContent: string, updatedContent: string): string {
  const originalLines = originalContent.split('\n');
  const updatedLines = updatedContent.split('\n');

  const headerFrom = `--- ${filePath}`;
  const headerTo = `+++ ${filePath}`;

  // Find changed regions and build hunk
  const hunks: string[] = [];
  let i = 0;
  let j = 0;

  while (i < originalLines.length || j < updatedLines.length) {
    if (i < originalLines.length && j < updatedLines.length && originalLines[i] === updatedLines[j]) {
      i++;
      j++;
      continue;
    }

    // Found a difference — collect context lines (up to 3 before)
    const hunkStartOrig = Math.max(0, i - 3);
    const hunkStartNew = Math.max(0, j - 3);

    const hunkLines: string[] = [];

    // Context before
    for (let k = hunkStartOrig; k < i; k++) {
      hunkLines.push(` ${originalLines[k]}`);
    }

    // Collect all changed lines
    const origStart = i + 1;
    const newStart = j + 1;
    let origCount = i - hunkStartOrig;
    let newCount = j - hunkStartNew;

    while (i < originalLines.length && j < updatedLines.length && originalLines[i] !== updatedLines[j]) {
      hunkLines.push(`-${originalLines[i]}`);
      hunkLines.push(`+${updatedLines[j]}`);
      origCount++;
      newCount++;
      i++;
      j++;
    }

    // Handle trailing removed or added lines
    while (i < originalLines.length && (j >= updatedLines.length || originalLines[i] !== updatedLines[j])) {
      hunkLines.push(`-${originalLines[i]}`);
      origCount++;
      i++;
    }

    while (j < updatedLines.length && (i >= originalLines.length || originalLines[i] !== updatedLines[j])) {
      hunkLines.push(`+${updatedLines[j]}`);
      newCount++;
      j++;
    }

    // Context after (up to 3 lines)
    let afterCount = 0;
    while (afterCount < 3 && i < originalLines.length && j < updatedLines.length && originalLines[i] === updatedLines[j]) {
      hunkLines.push(` ${originalLines[i]}`);
      origCount++;
      newCount++;
      i++;
      j++;
      afterCount++;
    }

    hunks.push(`@@ -${origStart},${origCount} +${newStart},${newCount} @@\n${hunkLines.join('\n')}`);
  }

  if (hunks.length === 0) return '';

  return `${headerFrom}\n${headerTo}\n${hunks.join('\n')}`;
}

export async function applyFix(fix: FixProposal): Promise<FixResult> {
  const content = await readFile(fix.file, 'utf-8');

  if (!content.includes(fix.oldText)) {
    return { applied: false, file: fix.file, diff: '' };
  }

  const updatedContent = content.replace(fix.oldText, fix.newText);
  await writeFile(fix.file, updatedContent, 'utf-8');

  const diff = generateUnifiedDiff(fix.file, content, updatedContent);

  return { applied: true, file: fix.file, diff };
}

export async function generateDiffPreview(fix: FixProposal): Promise<string> {
  const content = await readFile(fix.file, 'utf-8');

  if (!content.includes(fix.oldText)) {
    return '';
  }

  const updatedContent = content.replace(fix.oldText, fix.newText);
  return generateUnifiedDiff(fix.file, content, updatedContent);
}

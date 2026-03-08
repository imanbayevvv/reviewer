import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd(), '..', '..');
const SCREENS_YAML = path.join(PROJECT_ROOT, 'registry', 'screens.yaml');

// ── Safe YAML field updater ──────────────────────────────
//
// Strategy: targeted line-level replacement rather than full YAML
// parse/serialize, which would destroy comments, ordering, and formatting.
//
// We find the screen block by screen_id, then locate the figma.node_id
// line within that block and replace it. We also clear the
// unconfigured_reason field if present.

function updateScreenMapping(
  yamlContent: string,
  screenId: string,
  nodeId: string,
): { updated: string; changed: boolean; error?: string } {
  const lines = yamlContent.split('\n');

  // Find the screen block start: "  - screen_id: <screenId>"
  const screenIdPattern = new RegExp(`^\\s*-\\s*screen_id:\\s*${escapeRegex(screenId)}\\s*$`);
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (screenIdPattern.test(lines[i])) {
      blockStart = i;
      break;
    }
  }

  if (blockStart === -1) {
    return { updated: yamlContent, changed: false, error: `Screen ${screenId} not found in registry` };
  }

  // Find block end (next screen entry or end of file)
  let blockEnd = lines.length;
  for (let i = blockStart + 1; i < lines.length; i++) {
    if (/^\s*-\s*screen_id:/.test(lines[i])) {
      blockEnd = i;
      break;
    }
  }

  // Find and replace node_id line within block
  let nodeIdUpdated = false;
  let unconfiguredCleared = false;

  for (let i = blockStart; i < blockEnd; i++) {
    const line = lines[i];

    // Replace node_id value
    if (/^\s+node_id:\s*"/.test(line)) {
      lines[i] = line.replace(/node_id:\s*"[^"]*"/, `node_id: "${nodeId}"`);
      nodeIdUpdated = true;
    }

    // Clear unconfigured_reason (set to null or remove)
    if (/^\s+unconfigured_reason:\s*"/.test(line) || /^\s+unconfigured_reason:\s*[^n]/.test(line)) {
      // Replace the value with null to indicate it's now configured
      lines[i] = line.replace(/unconfigured_reason:\s*"[^"]*"/, 'unconfigured_reason: null');
      lines[i] = lines[i].replace(/unconfigured_reason:\s*[^n\s].*/, 'unconfigured_reason: null');
      unconfiguredCleared = true;
    }
  }

  if (!nodeIdUpdated) {
    return { updated: yamlContent, changed: false, error: `Could not find figma.node_id field for screen ${screenId}` };
  }

  return {
    updated: lines.join('\n'),
    changed: true,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── POST handler ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { screen_id, node_id, mode } = body as {
      screen_id: string;
      node_id: string;
      mode?: 'save' | 'patch';
    };

    if (!screen_id || !node_id) {
      return NextResponse.json(
        { error: 'screen_id and node_id are required' },
        { status: 400 },
      );
    }

    // Validate node_id format (Figma uses "N:N" format)
    if (!/^\d+:\d+$/.test(node_id)) {
      return NextResponse.json(
        { error: `Invalid node_id format: ${node_id}. Expected format like "24:45"` },
        { status: 400 },
      );
    }

    const yamlContent = fs.readFileSync(SCREENS_YAML, 'utf-8');

    const result = updateScreenMapping(yamlContent, screen_id, node_id);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (!result.changed) {
      return NextResponse.json({ status: 'unchanged', message: 'No changes needed' });
    }

    if (mode === 'patch') {
      // Return the patch content without saving
      return NextResponse.json({
        status: 'patch_generated',
        screen_id,
        node_id,
        patch: result.updated,
        message: 'Patch generated. Review and apply manually.',
      });
    }

    // Default: save directly
    // Create backup first
    const backupPath = SCREENS_YAML + '.bak';
    fs.copyFileSync(SCREENS_YAML, backupPath);

    // Write updated YAML
    fs.writeFileSync(SCREENS_YAML, result.updated, 'utf-8');

    return NextResponse.json({
      status: 'saved',
      screen_id,
      node_id,
      backup_path: backupPath,
      message: `Mapped ${screen_id} → ${node_id}. Backup saved. Run diff to verify.`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save mapping: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

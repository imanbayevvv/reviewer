import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd(), '..', '..');
const STORAGE_DIR = path.join(PROJECT_ROOT, 'storage');

/**
 * Serves reviewer artifact images from storage/.
 *
 * Query params:
 *   type=figma|runtime|diff|overlay
 *   screen=<screen_id>
 *   run=<run_id>  (required for diff/overlay)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const type = searchParams.get('type');
  const screen = searchParams.get('screen');
  const run = searchParams.get('run');

  if (!type || !screen) {
    return NextResponse.json({ error: 'Missing type or screen param' }, { status: 400 });
  }

  let filePath: string;
  switch (type) {
    case 'figma':
      filePath = path.join(STORAGE_DIR, 'figma', screen, 'figma.png');
      break;
    case 'runtime':
      filePath = path.join(STORAGE_DIR, 'runtime', screen, 'runtime.png');
      break;
    case 'diff':
      if (!run) return NextResponse.json({ error: 'Missing run param for diff' }, { status: 400 });
      filePath = path.join(STORAGE_DIR, 'runs', run, 'diff', screen, 'diff.png');
      break;
    case 'overlay':
      if (!run) return NextResponse.json({ error: 'Missing run param for overlay' }, { status: 400 });
      filePath = path.join(STORAGE_DIR, 'runs', run, 'diff', screen, 'overlay.png');
      break;
    default:
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  }

  // Validate the resolved path stays within storage
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(STORAGE_DIR))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return new NextResponse(null, { status: 404 });
  }

  const data = fs.readFileSync(resolved);
  return new NextResponse(data, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const PROJECT_ROOT = path.resolve(process.cwd(), '..', '..');
const FLOWS_YAML = path.join(PROJECT_ROOT, 'registry', 'flows.yaml');
const SCREENS_YAML = path.join(PROJECT_ROOT, 'registry', 'screens.yaml');

export interface FlowNode {
  id: string;
  screen_id: string;
  route: string;
  step: number;
  variant: string;
  flow_id: string;
  /** True if this node's screen_id belongs to a different flow */
  is_external: boolean;
}

export interface FlowEdge {
  from: string;
  to: string;
  trigger: string;
  type: 'next' | 'alternate' | 'error' | 'data_variant';
  notes?: string;
}

export interface FlowGraph {
  flow_id: string;
  title: string;
  entry_route: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export async function GET() {
  try {
    const flowsRaw = fs.readFileSync(FLOWS_YAML, 'utf-8');
    const { flows } = parse(flowsRaw) as { flows: any[] };

    const screensRaw = fs.readFileSync(SCREENS_YAML, 'utf-8');
    const { screens } = parse(screensRaw) as { screens: any[] };

    // Build screen lookup
    const screenMap = new Map<string, any>();
    for (const s of screens) {
      screenMap.set(s.screen_id, s);
    }

    const graphs: FlowGraph[] = flows.map(flow => {
      const nodes: FlowNode[] = flow.nodes.map((n: any) => {
        const screen = screenMap.get(n.screen_id);
        return {
          id: n.id,
          screen_id: n.screen_id,
          route: n.route,
          step: screen?.step ?? 0,
          variant: screen?.variant ?? 'default',
          flow_id: screen?.flow_id ?? flow.flow_id,
          is_external: screen ? screen.flow_id !== flow.flow_id : false,
        };
      });

      const edges: FlowEdge[] = (flow.edges || []).map((e: any) => ({
        from: e.from,
        to: e.to,
        trigger: e.trigger,
        type: e.type || 'next',
        notes: e.notes,
      }));

      return {
        flow_id: flow.flow_id,
        title: flow.title,
        entry_route: flow.entry_route,
        nodes,
        edges,
      };
    });

    return NextResponse.json({ flows: graphs });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to load flows: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

import fs from 'node:fs';
import { parse } from 'yaml';
import { SCREENS_YAML, FLOWS_YAML } from './config.js';

// ── Types ────────────────────────────────────────────────

export interface ScreenMask {
  selector: string;
  reason: string;
}

export interface ScreenThresholds {
  pixel_diff_percent: number;
  structural_similarity: number;
}

export interface ScreenFigma {
  file_key: string;
  node_id: string;
}

export interface ScreenViewport {
  width: number;
  height: number;
}

export interface ScreenPreconditions {
  auth: boolean;
  data?: string;
  trigger?: string;
}

export interface ScreenAction {
  action: 'click' | 'fill' | 'wait' | 'press';
  selector?: string;
  value?: string;
  key?: string;
  timeout?: number;
}

export interface ScreenSetup {
  strategy: 'direct' | 'wizard_inject' | 'action_sequence';
  user_type?: 'main' | 'empty';
  query_params?: Record<string, string>;
  actions?: ScreenAction[];
  wait_for?: string;
}

export interface Screen {
  screen_id: string;
  flow_id: string;
  step: number;
  variant: string;
  route: string;
  preconditions: ScreenPreconditions;
  setup?: ScreenSetup;
  figma: ScreenFigma;
  viewport: ScreenViewport;
  masks: ScreenMask[];
  thresholds: ScreenThresholds;
  tags: string[];
  notes?: string;
}

export interface FlowNode {
  id: string;
  screen_id: string;
  route: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  trigger: string;
  type: string;
  uncertain?: boolean;
  notes?: string;
}

export interface Flow {
  flow_id: string;
  title: string;
  entry_route: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  notes?: string;
}

// ── Parsing ──────────────────────────────────────────────

export function loadScreens(): Screen[] {
  const raw = fs.readFileSync(SCREENS_YAML, 'utf-8');
  const doc = parse(raw) as { screens: Screen[] };
  return doc.screens;
}

export function loadFlows(): Flow[] {
  const raw = fs.readFileSync(FLOWS_YAML, 'utf-8');
  const doc = parse(raw) as { flows: Flow[] };
  return doc.flows;
}

// ── Filters ──────────────────────────────────────────────

export function filterScreens(
  screens: Screen[],
  opts: { screenId?: string; flowId?: string; tag?: string },
): Screen[] {
  let result = screens;
  if (opts.screenId) {
    const id = opts.screenId;
    result = result.filter((s) => s.screen_id === id);
  }
  if (opts.flowId) {
    const fid = opts.flowId;
    result = result.filter((s) => s.flow_id === fid);
  }
  if (opts.tag) {
    const t = opts.tag;
    result = result.filter((s) => s.tags.includes(t));
  }
  return result;
}

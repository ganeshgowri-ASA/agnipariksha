export interface PVModule {
  module_id: string;
  manufacturer: string;
  model: string;
  technology: string;
  pmax_stc: number;
  voc: number;
  isc: number;
  vmpp: number;
  impp: number;
  bifaciality: number;
  area_m2: number;
  junction_box: string;
  bypass_diode_part: string;
  datasheet_url: string;
  notes: string;
  created_at?: string;
}

export type ModuleInput = Omit<PVModule, 'module_id' | 'created_at'>;

export interface TestRunSummary {
  run_id: string;
  module_id: string;
  test_type: string;
  iec_clause: string;
  params: Record<string, unknown>;
  started_at: string;
  ended_at?: string | null;
  status: string;
  pass_fail?: string | null;
  operator: string;
  summary_stats: Record<string, unknown>;
  telemetry_points: number;
}

export interface AIThreadSummary {
  thread_id: string;
  module_id?: string | null;
  run_id?: string | null;
  tab_context: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AICitation {
  clause_id: string;
  title: string;
}

export interface AIToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
}

export interface AIMessage {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  citations: AICitation[];
  tool_calls: AIToolCall[];
  created_at: string;
}

export interface AIThread extends AIThreadSummary {
  messages: AIMessage[];
}

export interface LiveTelemetrySample {
  t: number;
  voltage: number;
  current: number;
  power: number;
  temperature: number | null;
}

export const DEFAULT_MODULE: ModuleInput = {
  manufacturer: '',
  model: '',
  technology: 'mono-PERC',
  pmax_stc: 0,
  voc: 0,
  isc: 0,
  vmpp: 0,
  impp: 0,
  bifaciality: 0,
  area_m2: 0,
  junction_box: '',
  bypass_diode_part: '',
  datasheet_url: '',
  notes: '',
};

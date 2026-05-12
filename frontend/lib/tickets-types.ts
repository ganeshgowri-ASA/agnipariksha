export type TicketType = 'maintenance' | 'complaint';
export type TicketState =
  | 'open'
  | 'in_progress'
  | 'waiting_part'
  | 'resolved'
  | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'critical';

export interface TicketLinks {
  equipment_id?: string | null;
  module_id?: string | null;
  test_run_id?: string | null;
}

export interface TicketAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  created_at: number;
}

export interface Ticket {
  id: string;
  type: TicketType;
  title: string;
  description: string;
  state: TicketState;
  priority: TicketPriority;
  assignee: string | null;
  reporter: string | null;
  links: TicketLinks;
  tags: string[];
  source: string | null;
  attachments: TicketAttachment[];
  history: Array<Record<string, unknown>>;
  created_at: number;
  updated_at: number;
  due_at: number;
  sla_breached: boolean;
}

export interface TicketCreate {
  type: TicketType;
  title: string;
  description?: string;
  priority?: TicketPriority;
  assignee?: string;
  reporter?: string;
  links?: TicketLinks;
  tags?: string[];
  source?: string;
}

export const TICKET_STATES: TicketState[] = [
  'open',
  'in_progress',
  'waiting_part',
  'resolved',
  'closed',
];

export const TICKET_STATE_LABEL: Record<TicketState, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_part: 'Waiting Part',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
};

export const SLA_HOURS: Record<TicketPriority, number> = {
  critical: 4,
  high: 12,
  normal: 48,
  low: 120,
};

export const TICKET_TRANSITIONS: Record<TicketState, TicketState[]> = {
  open: ['in_progress', 'waiting_part', 'resolved', 'closed'],
  in_progress: ['waiting_part', 'resolved', 'open', 'closed'],
  waiting_part: ['in_progress', 'resolved', 'closed'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

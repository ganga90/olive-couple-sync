export interface Move {
  task_id: string;
  task_title: string;
  from_list: string | null;
  from_list_id: string | null;
  to_list: string;
  to_list_id: string | null;
  is_new_list: boolean;
  reason: string;
}

export interface OrganizationPlan {
  new_lists_to_create: string[];
  moves: Move[];
  summary: string;
}

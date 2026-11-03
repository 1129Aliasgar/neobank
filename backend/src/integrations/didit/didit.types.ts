/**
 * Didit wire types.
 *
 * Only the fields we actually read are declared. Everything else is ignored on
 * purpose: a provider response is an external contract and we should not couple
 * the domain to fields we do not use.
 *
 * @author aliasgarbootwala3@gmail.com
 */

export interface DiditCreateSessionBody {
  workflow_id: string;
  vendor_data: string;
  callback?: string;
  callback_method?: "initiator" | "completer" | "both";
  metadata: Record<string, unknown>;
  expected_details?: {
    company_name?: string;
    registry_country?: string;
    registration_number?: string;
  };
  sandbox_scenario?: string;
}

export interface DiditCreateSessionResponse {
  session_id: string;
  session_kind?: "user" | "business";
  session_number?: number;
  session_token?: string;
  url: string;
  status: string;
  workflow_id?: string;
  vendor_data?: string;
  sandbox_scenario?: string | null;
}

export interface DiditDecisionFeature {
  risk?: string;
  status?: string;
  node_id?: string;
}

export interface DiditDecisionWarning {
  risk?: string;
  short_description?: string;
  check_status?: string;
  log_type?: string;
  feature?: string;
  node_id?: string;
}

export interface DiditDecisionResponse {
  session_id?: string;
  status: string;
  sandbox_scenario?: string | null;
  decision?: {
    status?: string;
    reject_labels?: string[];
    warnings?:
      | string[]
      | Array<DiditDecisionFeature>
      | Record<string, unknown>;
  };
  /**
   * Present on every decision. `status_warnings` is where KYB declines explain
   * themselves when `decision.reject_labels` is empty.
   */
  decision_trace?: {
    status?: string;
    decided_by?: string;
    decided_at?: string;
    status_warnings?: DiditDecisionWarning[];
  };
}

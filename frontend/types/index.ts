export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit_cost: number;
  selling_price: number;
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  location: string;
  capacity: number;
}

export interface InventoryRow {
  product_id: number;
  sku: string;
  product_name: string;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  current_stock: number;
  reserved_stock: number;
  available_stock: number;
  incoming_stock: number;
  avg_daily_demand: number;
  demand_source: string;
  safety_stock: number;
  reorder_point: number;
  target_stock: number;
  recommended_order_quantity: number;
  alert_level: string;
  stockout_risk: boolean;
  days_of_cover: number | null;
  explanation: string;
}

export interface ForecastPoint {
  date: string;
  predicted_units: number;
}

export interface ForecastResult {
  product_id: number;
  sku: string;
  product_name: string;
  model: string;
  horizon_days: number;
  avg_daily_demand: number;
  total_predicted_units: number;
  fallback: boolean;
  predictions: ForecastPoint[];
  metrics?: Record<string, Record<string, number>>;
  created_at?: string;
}

export interface MetricBlock {
  mae: number;
  rmse: number;
  wape: number;
  n_observations: number;
}

export interface TrainReport {
  product_id: string | number;
  sku: string;
  product_name?: string;
  trained: boolean;
  reason?: string | null;
  observations: number;
  metrics: { xgboost?: MetricBlock; moving_average?: MetricBlock };
  comparison?: { best_model?: string; wape_improvement?: number | null };
}

export interface SupplierOffer {
  product_id: number;
  sku: string;
  product_name: string;
  unit_price: number;
  lead_time_days: number;
  reliability_score: number;
  minimum_order_quantity: number;
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
  contact_email: string;
  status: string;
  offers: SupplierOffer[];
}

export interface RankedSupplier {
  supplier_id: number;
  supplier_name: string;
  score: number;
  eligible: boolean;
  unit_price: number;
  lead_time_days: number;
  reliability_score: number;
  meets_moq: boolean;
  eligibility?: boolean;
  explanation: string;
  rank?: number;
  component_scores?: Record<string, number>;
  total_cost?: number;
}

export interface SupplierRecommendation {
  product_id: number;
  sku: string;
  product_name: string;
  quantity: number;
  weights: Record<string, number>;
  ranked_suppliers: RankedSupplier[];
  recommended_supplier_id: number | null;
  recommended_supplier_name: string | null;
  recommendation: string;
}

export interface PurchaseOrder {
  id: number | null;
  product_id: number;
  sku: string;
  product_name: string;
  warehouse_id?: number;
  warehouse_code: string;
  supplier_name: string;
  quantity: number;
  unit_price: number;
  total_cost: number;
  order_date?: string;
  expected_delivery_date: string | null;
  status: string;
  explanation: string;
}

export interface Disruption {
  id: number;
  supplier_id: number;
  supplier_name: string;
  product_id: number | null;
  sku: string | null;
  disruption_type: string;
  delay_days: number;
  severity: string;
  status: string;
  started_at: string;
  expected_resolution_date: string | null;
  notes: string;
}

export interface DisruptionAssessment {
  disruption: Disruption;
  overall_stockout_risk: string;
  affected_products: Array<{
    product_id: number;
    sku: string;
    product_name: string;
    base_lead_time_days: number;
    effective_lead_time_days: number;
    alternative_supplier_count: number;
  }>;
  affected_warehouses: Array<{
    warehouse_id: number;
    warehouse_code: string;
    warehouse_name: string;
    available_stock: number;
    avg_daily_demand: number;
    days_until_delivery: number;
    risk: string;
    days_of_cover: number | null;
    projected_shortfall: number;
    explanation: string;
  }>;
  alternative_suppliers: RankedSupplier[];
  transfer_suggestion: {
    product_id: number;
    to_warehouse_id: number;
    requested_quantity: number;
    allocated_quantity: number;
    unmet_quantity: number;
    feasible: boolean;
    transfers: Array<{
      from_warehouse_id: number;
      from_warehouse_name: string;
      quantity: number;
    }>;
    explanation: string;
  } | null;
  recovery: { actions: string[]; recovery_needed: boolean; rationale: string };
  summary?: string;
}

export interface AgentLog {
  id: number;
  agent_name: string;
  step_index: number;
  status: string;
  message: string;
  duration_ms: number;
  payload: Record<string, unknown> | null;
  created_at: string | null;
}

export interface VerificationCheck {
  check: string;
  passed: boolean;
  detail: string;
}

export interface Decision {
  action: string;
  product_id: number;
  sku: string;
  warehouse_id: number;
  warehouse_code?: string;
  supplier_name?: string;
  quantity: number;
  cost?: number;
  approved: boolean;
  reason: string;
}

export interface WorkflowSummary {
  scenario?: string;
  horizon_days?: number;
  as_of?: string;
  products_forecasted?: number;
  inventory_alerts?: Record<string, number>;
  replenishment_items?: number;
  replenishment_units?: number;
  purchase_orders?: number;
  procurement_value?: number;
  active_disruptions?: number;
  worst_stockout_risk?: string | null;
  transfers?: number;
  transfer_units?: number;
  verification?: {
    approved: boolean | null;
    failed_checks: string[];
    summary: string | null;
    checks: VerificationCheck[];
    conflicts: Array<Record<string, unknown>>;
  };
  decisions?: Decision[];
  recommended_actions?: string[];
}

export interface AgentExecution {
  execution_id: string;
  status: string;
  scenario: string;
  current_agent: string | null;
  horizon_days?: number;
  started_at: string | null;
  finished_at: string | null;
  error?: string | null;
  progress: number;
  completed_agents?: string[];
  summary: WorkflowSummary | null;
  logs: AgentLog[];
}

export interface ReportSummary {
  generated_at: string;
  data_source: string;
  totals: {
    products: number;
    warehouses: number;
    suppliers: number;
    active_suppliers: number;
    inventory_value: number;
    sales_rows: number;
    inventory_rows: number;
  };
  inventory: {
    alerts: Record<string, number>;
    low_stock_products: string[];
    critical_products: string[];
    overstocked_products: string[];
    stockout_risk_items: number;
    replenishment_required: number;
    recommended_order_units: number;
  };
  forecasting: {
    models_trained: number;
    models_with_fallback: number;
    avg_xgboost_wape: number | null;
    avg_baseline_wape: number | null;
    persisted_forecast_rows: number;
    last_trained_at: string | null;
  };
  procurement: {
    pending_recommendations: number;
    pending_value: number;
    purchase_orders: number;
  };
  disruptions: {
    active: number;
    critical: number;
    by_severity: Record<string, number>;
  };
  transfers: { records: number; units: number };
  recommendations: { records: number };
  sales_history: { date_range: [string, string] | null };
  recent_executions: Array<{
    execution_id: string;
    status: string;
    scenario: string;
    started_at: string | null;
    finished_at: string | null;
    summary: WorkflowSummary | null;
  }>;
  agent_statistics: {
    executions: number;
    completed: number;
    failed: number;
    success_rate: number | null;
    avg_execution_seconds: number | null;
    agent_logs: number;
    per_agent: Array<{ agent_name: string; runs: number; avg_duration_ms: number }>;
  };
}

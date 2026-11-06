"""Synthetic demonstration data generator.

Nothing here is real business data. Every record created by this module is
labelled as synthetic in ``data/sample/README.md`` and in the API
(``/api/reports/summary`` reports ``data_source = "synthetic"`` until a user
uploads a real CSV).
"""

from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pandas as pd

WAREHOUSES = [
    {"code": "W1", "name": "Central Fulfilment", "location": "Pune, MH", "capacity": 6000.0},
    {"code": "W2", "name": "North Distribution", "location": "Delhi, DL", "capacity": 5000.0},
    {"code": "W3", "name": "South Distribution", "location": "Chennai, TN", "capacity": 4500.0},
]

PRODUCTS = [
    {"sku": "P001", "name": "Industrial Bearing 6204", "category": "Mechanical", "unit_cost": 4.20, "selling_price": 6.50},
    {"sku": "P002", "name": "Hydraulic Seal Kit", "category": "Mechanical", "unit_cost": 9.80, "selling_price": 14.50},
    {"sku": "P003", "name": "Conveyor Belt 3m", "category": "Material Handling", "unit_cost": 48.00, "selling_price": 72.00},
    {"sku": "P004", "name": "Stepper Motor NEMA23", "category": "Electrical", "unit_cost": 31.00, "selling_price": 46.00},
    {"sku": "P005", "name": "Steel Fastener Pack", "category": "Hardware", "unit_cost": 2.10, "selling_price": 3.60},
    {"sku": "P006", "name": "Pneumatic Valve 5/2", "category": "Pneumatics", "unit_cost": 18.40, "selling_price": 27.00},
    {"sku": "P007", "name": "Safety Gloves Pro", "category": "Safety", "unit_cost": 3.40, "selling_price": 5.90},
    {"sku": "P008", "name": "Gearbox 1:10", "category": "Mechanical", "unit_cost": 72.00, "selling_price": 108.00},
]

SUPPLIERS = [
    {"code": "S001", "name": "Apex Industrial Supplies", "contact_email": "orders@apex.example", "status": "active"},
    {"code": "S002", "name": "Meridian Components", "contact_email": "sales@meridian.example", "status": "active"},
    {"code": "S003", "name": "Northline Trading", "contact_email": "supply@northline.example", "status": "active"},
    {"code": "S004", "name": "Vertex Global Parts", "contact_email": "desk@vertex.example", "status": "active"},
    {"code": "S005", "name": "RapidSource Ltd", "contact_email": "ops@rapidsource.example", "status": "suspended"},
]

# (sku, supplier code, price multiplier, lead time, reliability, MOQ)
SUPPLIER_OFFERS = [
    ("P001", "S001", 1.00, 7, 0.95, 50),
    ("P001", "S002", 0.94, 12, 0.88, 25),
    ("P001", "S003", 0.90, 16, 0.74, 25),
    ("P001", "S004", 1.06, 5, 0.91, 100),
    ("P002", "S001", 1.00, 9, 0.93, 40),
    ("P002", "S002", 0.92, 14, 0.85, 20),
    ("P002", "S004", 1.10, 6, 0.90, 60),
    ("P003", "S002", 1.00, 18, 0.90, 10),
    ("P003", "S003", 0.95, 24, 0.78, 10),
    ("P003", "S004", 1.12, 11, 0.89, 20),
    ("P004", "S001", 1.00, 10, 0.92, 30),
    ("P004", "S003", 0.91, 20, 0.76, 20),
    ("P004", "S004", 1.08, 8, 0.90, 50),
    ("P005", "S001", 1.00, 5, 0.96, 200),
    ("P005", "S002", 0.88, 9, 0.87, 100),
    ("P006", "S001", 1.04, 8, 0.91, 25),
    ("P006", "S002", 1.00, 13, 0.86, 15),
    ("P006", "S004", 1.09, 7, 0.88, 40),
    ("P007", "S002", 1.00, 6, 0.94, 150),
    ("P007", "S003", 0.93, 11, 0.80, 100),
    ("P008", "S002", 1.00, 21, 0.89, 5),
    ("P008", "S004", 1.15, 14, 0.87, 10),
]

# Baseline daily demand per (sku, warehouse) - used to synthesise history only.
BASE_DEMAND = {
    ("P001", "W1"): 45.0,
    ("P001", "W2"): 30.0,
    ("P001", "W3"): 22.0,
    ("P002", "W1"): 26.0,
    ("P002", "W2"): 18.0,
    ("P002", "W3"): 12.0,
    ("P003", "W1"): 9.0,
    ("P003", "W2"): 6.0,
    ("P003", "W3"): 5.0,
    ("P004", "W1"): 14.0,
    ("P004", "W2"): 10.0,
    ("P004", "W3"): 8.0,
    ("P005", "W1"): 70.0,
    ("P005", "W2"): 52.0,
    ("P005", "W3"): 40.0,
    ("P006", "W1"): 12.0,
    ("P006", "W2"): 9.0,
    ("P006", "W3"): 7.0,
    ("P007", "W1"): 55.0,
    ("P007", "W2"): 44.0,
    ("P007", "W3"): 33.0,
    ("P008", "W1"): 5.0,
    ("P008", "W2"): 4.0,
    ("P008", "W3"): 3.0,
}

# Demonstration state: Product A (P001) demand uplift in W1, stock parked in W2/W3.
DEMO_UPLIFT = {("P001", "W1"): 1.35, ("P001", "W2"): 1.10}
DEMO_UPLIFT_DAYS = 30

INITIAL_STOCK = {
    ("P001", "W1"): 45.0,
    ("P001", "W2"): 2400.0,
    ("P001", "W3"): 1650.0,
    ("P002", "W1"): 260.0,
    ("P002", "W2"): 540.0,
    ("P002", "W3"): 380.0,
    ("P003", "W1"): 90.0,
    ("P003", "W2"): 210.0,
    ("P003", "W3"): 150.0,
    ("P004", "W1"): 210.0,
    ("P004", "W2"): 320.0,
    ("P004", "W3"): 240.0,
    ("P005", "W1"): 900.0,
    ("P005", "W2"): 1400.0,
    ("P005", "W3"): 1100.0,
    ("P006", "W1"): 180.0,
    ("P006", "W2"): 260.0,
    ("P006", "W3"): 190.0,
    ("P007", "W1"): 700.0,
    ("P007", "W2"): 950.0,
    ("P007", "W3"): 800.0,
    ("P008", "W1"): 60.0,
    ("P008", "W2"): 95.0,
    ("P008", "W3"): 70.0,
}


def generate_sales_frame(days: int = 180, end_date: date | None = None, seed: int = 7) -> pd.DataFrame:
    """Create a deterministic synthetic sales history frame."""
    rng = np.random.default_rng(seed)
    end_date = end_date or date.today()
    start_date = end_date - timedelta(days=days - 1)
    names = {p["sku"]: p["name"] for p in PRODUCTS}
    prices = {p["sku"]: p["selling_price"] for p in PRODUCTS}

    rows: list[dict] = []
    for (sku, warehouse), base in BASE_DEMAND.items():
        recent_window = DEMO_UPLIFT.get((sku, warehouse), 1.0)
        for offset in range(days):
            day = start_date + timedelta(days=offset)
            trend = 1.0 + 0.0009 * offset
            weekly = 1.0 + 0.18 * math.sin(2 * math.pi * day.weekday() / 7)
            monthly = 1.0 + 0.07 * math.sin(2 * math.pi * day.day / 30)
            uplift = recent_window if (days - offset) <= DEMO_UPLIFT_DAYS else 1.0
            noise = rng.normal(1.0, 0.16)
            units = max(0, int(round(base * trend * weekly * monthly * uplift * noise)))
            rows.append(
                {
                    "date": day.isoformat(),
                    "product_id": sku,
                    "product_name": names[sku],
                    "warehouse_id": warehouse,
                    "units_sold": units,
                    "selling_price": prices[sku],
                }
            )
    frame = pd.DataFrame(rows)
    return frame.sort_values(["date", "product_id", "warehouse_id"]).reset_index(drop=True)


def inventory_frame() -> pd.DataFrame:
    """Current stock snapshot matching the demonstration scenario."""
    names = {p["sku"]: p["name"] for p in PRODUCTS}
    rows = []
    for (sku, warehouse), stock in INITIAL_STOCK.items():
        capacity = 2000.0 if sku != "P005" else 4000.0
        rows.append(
            {
                "product_id": sku,
                "product_name": names[sku],
                "warehouse_id": warehouse,
                "current_stock": stock,
                "reserved_stock": round(stock * 0.05, 2),
                "incoming_stock": 0.0,
                "max_capacity": capacity,
            }
        )
    return pd.DataFrame(rows)


def supplier_frame() -> pd.DataFrame:
    """Supplier master plus per-product commercial terms (flattened)."""
    master = {s["code"]: s for s in SUPPLIERS}
    prices = {p["sku"]: p["unit_cost"] for p in PRODUCTS}
    rows = []
    for sku, code, multiplier, lead, reliability, moq in SUPPLIER_OFFERS:
        supplier = master[code]
        rows.append(
            {
                "supplier_id": code,
                "supplier_name": supplier["name"],
                "supplier_status": supplier["status"],
                "product_id": sku,
                "unit_price": round(prices[sku] * multiplier, 2),
                "lead_time_days": lead,
                "reliability_score": reliability,
                "minimum_order_quantity": moq,
            }
        )
    return pd.DataFrame(rows)

"""Integration tests for the FastAPI endpoints."""

from __future__ import annotations

import io

import pytest

from forecasting.preprocessing import build_template_frame


def test_health_reports_database(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"]["status"] == "ok"
    assert body["llm_required"] is False


def test_root_metadata(client):
    body = client.get("/").json()
    assert body["docs"] == "/docs"


def test_products_listing_and_creation(client):
    listing = client.get("/api/products")
    assert listing.status_code == 200
    assert len(listing.json()) >= 8

    created = client.post(
        "/api/products",
        json={
            "sku": "P900",
            "name": "Test Product",
            "category": "QA",
            "unit_cost": 4.5,
            "selling_price": 7.0,
        },
    )
    assert created.status_code == 201
    assert created.json()["sku"] == "P900"

    duplicate = client.post(
        "/api/products",
        json={"sku": "P900", "name": "Duplicate", "unit_cost": 1, "selling_price": 2},
    )
    assert duplicate.status_code == 409

    invalid = client.post("/api/products", json={"sku": "", "name": ""})
    assert invalid.status_code == 422


def test_warehouses_and_inventory(client):
    warehouses = client.get("/api/warehouses")
    assert warehouses.status_code == 200
    assert len(warehouses.json()) == 3

    inventory = client.get("/api/inventory")
    assert inventory.status_code == 200
    rows = inventory.json()
    assert len(rows) == 24
    assert {"safety_stock", "reorder_point", "alert_level"} <= set(rows[0])

    filtered = client.get("/api/inventory", params={"warehouse_id": warehouses.json()[0]["id"]})
    assert all(row["warehouse_id"] == warehouses.json()[0]["id"] for row in filtered.json())


def test_suppliers_catalog(client):
    suppliers = client.get("/api/suppliers")
    assert suppliers.status_code == 200
    catalog = suppliers.json()
    assert len(catalog) >= 5
    assert any(supplier["offers"] for supplier in catalog)
    assert any(supplier["status"] == "suspended" for supplier in catalog)


def test_sales_template_and_upload(client):
    template = client.get("/api/sales/template")
    assert template.status_code == 200
    assert "product_id" in template.text

    frame = build_template_frame()
    csv_bytes = frame.to_csv(index=False).encode()
    upload = client.post(
        "/api/sales/upload",
        files={"file": ("sales.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert upload.status_code == 200, upload.text
    assert upload.json()["accepted_rows"] == 2

    bad = client.post(
        "/api/sales/upload",
        files={"file": ("bad.csv", io.BytesIO(b"date,units_sold\n2026-01-01,5\n"), "text/csv")},
    )
    assert bad.status_code == 422
    assert "Missing mandatory column" in str(bad.json())

    wrong_type = client.post(
        "/api/sales/upload",
        files={"file": ("sales.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    assert wrong_type.status_code == 415


def test_forecast_endpoints(client, trained_models):
    train = client.post("/api/forecast/train", params={"background": False}, json={})
    assert train.status_code == 200
    body = train.json()
    assert body["status"] == "completed"
    assert body["result"]["n_trained"] >= 7

    predict = client.post("/api/forecast/predict", json={"horizon_days": 7})
    assert predict.status_code == 200
    results = predict.json()
    assert len(results) >= 8
    with_history = [r for r in results if r["predictions"]]
    # products without sales history are returned with an explicit "no_history" model
    assert len(with_history) >= 8
    assert all(len(r["predictions"]) == 7 for r in with_history)

    persisted = client.get("/api/forecast/results")
    assert persisted.status_code == 200
    assert persisted.json()

    metrics = client.get("/api/forecast/metrics")
    assert metrics.status_code == 200
    assert metrics.json()["n_trained"] >= 7

    bad = client.post("/api/forecast/predict", json={"horizon_days": 999})
    assert bad.status_code == 422

    backtest = client.get(f"/api/forecast/backtest/{with_history[0]['product_id']}")
    assert backtest.status_code == 200
    series = backtest.json()
    assert len(series["actual"]) == len(series["predicted"]) == 28
    assert "wape" in series["metrics"]


def test_inventory_optimize_and_recommendations(client):
    optimize = client.post(
        "/api/inventory/optimize", json={"service_level": 0.95, "review_period_days": 7}
    )
    assert optimize.status_code == 200
    assert optimize.json()["summary"]["items_evaluated"] == 24

    recommendations = client.get("/api/inventory/recommendations")
    assert recommendations.status_code == 200
    assert len(recommendations.json()) == 24

    transfers = client.get("/api/inventory/transfers")
    assert transfers.status_code == 200


def test_supplier_recommendation_endpoint(client):
    products = client.get("/api/products").json()
    p001 = next(p for p in products if p["sku"] == "P001")
    response = client.post(
        "/api/suppliers/recommend",
        json={"product_id": p001["id"], "quantity": 400},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["recommended_supplier_name"]
    assert len(body["ranked_suppliers"]) >= 2

    invalid = client.post(
        "/api/suppliers/recommend", json={"product_id": 99999, "quantity": 10}
    )
    assert invalid.status_code == 422


def test_procurement_generation_and_orders(client):
    response = client.post("/api/procurement/generate", json={})
    assert response.status_code == 200
    payload = response.json()
    assert payload["orders"]
    assert payload["summary"]["total_cost"] > 0

    orders = client.get("/api/procurement/orders")
    assert orders.status_code == 200
    assert any(order["status"] == "recommended" for order in orders.json())


def test_disruption_simulation_flow(client):
    suppliers = client.get("/api/suppliers").json()
    active_supplier = next(s for s in suppliers if s["status"] == "active")

    simulated = client.post(
        "/api/disruptions/simulate",
        json={
            "supplier_id": active_supplier["id"],
            "disruption_type": "delivery_delay",
            "delay_days": 9,
            "reliability_delta": -0.2,
        },
    )
    assert simulated.status_code == 200, simulated.text
    assessment = simulated.json()
    assert assessment["disruption"]["delay_days"] == 9
    assert assessment["recovery"]["actions"]

    active = client.get("/api/disruptions/active")
    assert active.status_code == 200
    ids = [d["id"] for d in active.json()]
    assert assessment["disruption"]["id"] in ids

    detail = client.get(f"/api/disruptions/{assessment['disruption']['id']}/assessment")
    assert detail.status_code == 200

    resolved = client.post(f"/api/disruptions/{assessment['disruption']['id']}/resolve")
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "resolved"

    missing = client.get("/api/disruptions/999999/assessment")
    assert missing.status_code == 404


def test_agent_execution_endpoints(client, trained_models):
    response = client.post(
        "/api/agents/execute",
        json={"scenario": "disruption_demo", "horizon_days": 7, "wait_for_completion": True},
    )
    assert response.status_code == 202
    body = response.json()
    execution_id = body["execution_id"]
    assert body["status"] == "completed"
    assert body["progress"] == 100

    status = client.get(f"/api/agents/status/{execution_id}")
    assert status.status_code == 200
    assert status.json()["status"] == "completed"

    logs = client.get(f"/api/agents/logs/{execution_id}")
    assert logs.status_code == 200
    assert len(logs.json()) >= 14  # start + completed per agent

    result = client.get(f"/api/agents/result/{execution_id}")
    assert result.status_code == 200
    assert result.json()["verification"]["checks"]

    history = client.get("/api/agents/executions")
    assert history.status_code == 200

    graph = client.get("/api/agents/graph")
    assert len(graph.json()["nodes"]) == 7

    missing = client.get("/api/agents/status/does-not-exist")
    assert missing.status_code == 404


def test_agent_execute_validation(client):
    bad_scenario = client.post("/api/agents/execute", json={"scenario": "nope"})
    assert bad_scenario.status_code == 422

    bad_horizon = client.post(
        "/api/agents/execute", json={"scenario": "standard_workflow", "horizon_days": 0}
    )
    assert bad_horizon.status_code == 422


def test_demo_endpoint(client, trained_models):
    response = client.post("/api/agents/demo", params={"wait_for_completion": True})
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "completed"
    assert body["summary"]["transfers"] >= 1


def test_reports_summary_and_download(client, trained_models):
    summary = client.get("/api/reports/summary")
    assert summary.status_code == 200
    body = summary.json()
    assert body["totals"]["products"] >= 8
    assert body["totals"]["warehouses"] == 3
    assert body["data_source"] == "synthetic_demo_plus_uploads"
    assert body["inventory"]["alerts"]

    for report in ("inventory", "forecasts", "purchase_orders", "agent_executions", "sales"):
        download = client.get("/api/reports/download", params={"report": report})
        assert download.status_code == 200, report
        assert download.headers["content-type"].startswith("text/csv")
        assert len(download.text) > 20

    unknown = client.get("/api/reports/download", params={"report": "nope"})
    assert unknown.status_code == 422


def test_openapi_available(client):
    schema = client.get("/openapi.json")
    assert schema.status_code == 200
    paths = schema.json()["paths"]
    for required in (
        "/health",
        "/api/products",
        "/api/warehouses",
        "/api/inventory",
        "/api/sales/upload",
        "/api/forecast/train",
        "/api/forecast/predict",
        "/api/forecast/results",
        "/api/inventory/optimize",
        "/api/inventory/recommendations",
        "/api/suppliers/recommend",
        "/api/procurement/generate",
        "/api/disruptions/simulate",
        "/api/agents/execute",
        "/api/agents/status/{execution_id}",
        "/api/agents/logs/{execution_id}",
        "/api/reports/summary",
        "/api/reports/download",
    ):
        assert required in paths, required

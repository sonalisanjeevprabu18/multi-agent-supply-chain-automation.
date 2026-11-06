# Deployment guide

Target topology:

```
Vercel project A  → frontend/        (Next.js 15)
Vercel project B  → repository root  (FastAPI via Vercel Python runtime)
Supabase          → PostgreSQL + optional Storage bucket
```

> **Status:** deployment was *not* executed from this workspace because no
> Vercel or GitHub credentials were available. Everything below was validated
> locally (build, tests, API responses); the production URLs are still to be
> filled in after you run these steps.

## 1. Supabase PostgreSQL

1. Create a project at <https://supabase.com>.
2. **Project Settings → Database → Connection string → URI**. Use the
   **connection pooler** host (port `6543`) for serverless deployments.
3. Convert the scheme to SQLAlchemy form:
   `postgresql+psycopg2://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
4. Store it as `DATABASE_URL` (Vercel env var / local `.env`). Never commit it.

Schema creation is automatic on API startup (`Base.metadata.create_all`). To seed
the synthetic demo rows explicitly:

```bash
python -m backend.database.seed --reset --days 180
```

Optional: create a Storage bucket (`supply-chain-artifacts`) if you want to
archive trained model artifacts; the application does not require it.

### Migrations

The capstone uses `create_all` plus explicit scripts rather than Alembic:

```bash
python -m backend.database.seed --reset          # recreate + seed
```

For a real production lifecycle, add Alembic before schema changes ship; the
documented limitation is that column changes currently require a reset script.

## 2. Backend — Vercel Python runtime

1. Push the repository to GitHub.
2. In Vercel: **Add New Project → Import** the repo.
3. **Root Directory:** repository root (leave empty).
4. Framework preset: *Other*. Build command: none (Vercel detects `api/index.py`
   through `vercel.json`). Install command: default (`pip install -r requirements.txt`).
5. Environment variables (Production **and** Preview):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase pooler URL |
   | `ALLOW_SQLITE_FALLBACK` | `false` |
   | `CORS_ORIGINS` | `https://<frontend>.vercel.app` |
   | `APP_ENV` | `production` |
   | `AUTO_SEED` | `true` (first deploy only, then `false`) |
   | `MAX_UPLOAD_MB` | `5` |
   | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | optional, server-side only |

6. Deploy, then verify:

```bash
curl https://<api>.vercel.app/health
# {"status":"ok","database":{"status":"ok","dialect":"postgresql"},...}
curl https://<api>.vercel.app/api/products
```

`api/index.py` exposes the ASGI `app`, and `vercel.json` routes every path to it,
so FastAPI routing (`/docs`, `/api/...`) works unchanged.

### Serverless limits and what they mean here

| Limit | Mitigation in this project |
| --- | --- |
| Function duration | Agent workflows are a few seconds on the demo dataset; the UI uses `wait_for_completion=true` (`NEXT_PUBLIC_WORKFLOW_SYNC=true`). Long runs can be dispatched to an external worker that calls `run_workflow`. |
| Bundle size (250 MB) | `xgboost` + `numpy`/`pandas` is large. If the bundle is rejected, either train artifacts offline and host them in Supabase Storage, or run the API on a container host (Render/Railway/Fly) and keep Vercel for the frontend. |
| Ephemeral filesystem | Model artifacts (`MODEL_ARTIFACT_DIR`) do not persist between invocations; missing artifacts degrade to the moving-average baseline, which the API labels explicitly. |
| Request payload | CSV uploads are capped by `MAX_UPLOAD_MB` (default 5 MB) and validated before ingestion. |
| Cold starts | Connection pooling via the Supabase pooler URL (`pool_pre_ping`, `pool_recycle`). |
| Background threads | Not guaranteed after the response; use synchronous execution or an external worker. |

## 3. Frontend — Vercel

1. **Add New Project → Import** the same repo.
2. **Root Directory:** `frontend`.
3. Framework preset: Next.js. Build `npm run build`, install `npm install`.
4. Environment variables:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | `https://<api>.vercel.app` |
   | `NEXT_PUBLIC_WORKFLOW_SYNC` | `true` |

5. Add the deployment URL to the backend's `CORS_ORIGINS` and redeploy the API.
6. Preview deployments inherit the same env vars; use a separate Supabase project
   or schema if previews must not touch production data.

## 4. Post-deployment verification checklist

Run every item against the real URLs and record the response:

- [ ] `GET /health` returns `status: ok` with `dialect: postgresql`
- [ ] `GET /api/products` returns seeded products
- [ ] `POST /api/sales/upload` with `data/sample/sales_history.csv` returns 200
- [ ] `POST /api/forecast/train?background=false` returns `n_trained > 0`
- [ ] `POST /api/forecast/predict` returns predictions
- [ ] `POST /api/inventory/optimize` returns `items_evaluated > 0`
- [ ] `POST /api/suppliers/recommend` returns a ranked list
- [ ] `POST /api/disruptions/simulate` returns an assessment
- [ ] `POST /api/agents/execute` with `wait_for_completion=true` completes
- [ ] `POST /api/agents/demo` completes and returns transfers + orders
- [ ] `GET /api/reports/summary` totals match the database
- [ ] Frontend loads, fetches every page from the API, and shows no console errors
- [ ] Foreign-origin request is rejected by CORS

## 5. GitHub

```bash
git init
git add .
git commit -m "feat: multi-agent supply chain automation"
git branch -M main
git remote add origin https://github.com/<user>/multi-agent-supply-chain-automation.git
git push -u origin main
```

`.gitignore` already excludes `.env*` (except `.env.example`), `.venv`, `node_modules`,
`.next`, model artifacts and local databases.

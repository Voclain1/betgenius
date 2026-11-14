# research/forecasting

A read-only extractor and statistical forecasting research pipeline: Poisson as the baseline, XGBoost as the model under test. It is isolated from the application. Nothing here is imported by `src/`, deployed, scheduled or published.

The full design, point-in-time rules, secure-execution steps and decision rule are in [docs/research/XGBOOST_RESEARCH_ENGINE.md](../../docs/research/XGBOOST_RESEARCH_ENGINE.md).

```bash
npm run check:research-extract                                   # extractor logic, synthetic rows
bash research/forecasting/extract/integration/run-local-integration.sh   # extractor vs throwaway local Postgres
cd research/forecasting && python -m pytest -q                   # modelling suite, synthetic data
python -m bgforecast synth --out work/syn && python -m bgforecast run --dataset work/syn --out work/syn-run --quick
```

The decision rule is a set of pre-registered gates (coverage on the whole dataset and on the test period, a 0.005-nat minimum gain plus paired CIs, calibration). They are decided from the primary test period only; alternative test boundaries are reported for stability and never used to tune or choose. Before running anything on the shared VPS, read the safe execution limits in section 11 of the docs.

Real extractions need `RESEARCH_READONLY_DATABASE_URL` for a dedicated read-only role, and are never run in CI. Outputs go to `work/`, which is gitignored and private.

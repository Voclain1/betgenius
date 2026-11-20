"""Offline historical capacity upper bound; no model/API/DB calls."""
import re, json, hashlib
from pathlib import Path
source=Path('docs/experiments/vip-quota/historical-source.txt')
s=source.read_text()
api_line=next(l for l in s.splitlines() if 'api-football per UTC day (all / odds):' in l)
api={day:int(calls) for day,calls in re.findall(r'(2026-11-\d\d) (\d+)/\d+',api_line)}
rows=[]
for line in s.splitlines():
 m=re.match(r'(2026-11-\d\d)\s+\d+\s+\d+\s*\|\s*(\d+)/(\d+)\s*\|\s*\d+\s+(\d+)\s*\|\s*(\d+)\s+\d+\s+(\d+)\s+(\d+)\s*\|',line)
 if not m:continue
 day,core,widened,lops,att,prom,pub=m.groups(); core,widened,lops,att,prom,pub=map(int,[core,widened,lops,att,prom,pub])
 baseline=min(8,lops); potential=max(0,min(16,lops)-baseline) if lops>=10 else 0
 # Sensitivity only: all eight baseline attempts on the kickoff creation day,
 # a hypothetical $0.10 ceiling and $0.028 conservative reservation. UTC API
 # final-day snapshots are not point-in-time availability in the Lagos window.
 same_day=min(potential,12-baseline)
 funded=min(same_day,3)
 api_remaining=max(0,7400-api[day])
 rows.append(dict(api_utc_day_used=api[day],api_paid_remaining_at_final_snapshot=api_remaining,all_baseline_on_same_creation_day_extra_bound=same_day,hypothetical_10_cent_budget_extra_bound=funded,final_api_snapshot_stress_extra_bound=funded if api_remaining>=200 else 0,day=day,cohort='international-break' if day>='2026-11-09' else 'core-calendar',core=core,widened=widened,closing_lopsided=lops,observed_attempts=att,observed_promotions=prom,observed_published=pub,baseline_capacity_upper_bound=baseline,extra_capacity_upper_bound=potential))
assert len(rows)==14
result={'source_run':'https://github.com/Voclain1/betgenius/actions/runs/43697810970','source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'method':'Closing-reference capacity upper bound only. Fresh quotes in the attempt window, ranking, daily 12-call cap, API headroom and model-cost reservations can only reduce this. No counterfactual model/gate outcomes available. Historical actuals predate kickoff-day quota; they are not the unchanged 8-attempt baseline.','days':rows,'cohorts':{}}
for cohort in ['core-calendar','international-break']:
 xs=[r for r in rows if r['cohort']==cohort]
 result['cohorts'][cohort]={k:sum(r[k] for r in xs) for k in ['observed_attempts','observed_promotions','baseline_capacity_upper_bound','extra_capacity_upper_bound','all_baseline_on_same_creation_day_extra_bound','hypothetical_10_cent_budget_extra_bound','final_api_snapshot_stress_extra_bound']}
result['sensitivity_assumptions']={'daily_model_usd':0.10,'reservation_usd':0.028,'meaning':'Arithmetic illustration, not approved pricing. Same-creation-day baseline consumes eight of the unchanged twelve calls. Final API snapshots are a stress case, not time-window reconstruction. The default disabled/unfunded experiment always permits zero extra attempts.'}
result['incremental_qualifying_promotions']=None
result['marginal_cost_per_promotion']=None
result['settled_results_and_calibration']=None
print(json.dumps(result,indent=2))

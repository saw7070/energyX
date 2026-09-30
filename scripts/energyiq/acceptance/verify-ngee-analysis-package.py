"""Independent frozen-input Ngee acceptance; does not execute model-authored code."""
import csv, gzip, json, hashlib, sys
from collections import defaultdict, Counter
from datetime import date
from pathlib import Path

run = Path(sys.argv[1])
source = run / 'inputs/meter-intervals.csv.gz'
assert hashlib.sha256(source.read_bytes()).hexdigest() == 'ce94c6e3b5cbba95b0af0b73cd7d00e0e9e61c9c720d4e3d3c3a458a04b9620e'
totals, floors, months, circuits = (defaultdict(float) for _ in range(4))
counts = defaultdict(Counter)
daily = defaultdict(float)
with gzip.open(source, 'rt') as f:
    for r in csv.DictReader(f):
        if not r['usage_kwh'] or r['quality_status'] not in ('ok', 'gap'):
            continue
        value = float(r['usage_kwh'])
        circuits[r['scope_id']] += value
        if r['official_aggregation_eligible'] != 'true':
            continue
        totals[r['quality_status']] += value
        floors[r['level_node_id']] += value
        months[r['local_date'][:7]] += value
        if r['quality_status'] == 'ok' and float(r['elapsed_minutes']) == 15:
            counts[r['local_date']][r['meter_node_id']] += 1
            daily[r['local_date']] += value

complete = {d for d, c in counts.items() if len(c) == 4 and all(v == 96 for v in c.values())}
config = json.loads((run / 'inputs/project-configuration.json').read_text(encoding='utf-8'))
calendar = config['calendar']['revision']
holidays = {e['date'] for entry in calendar['entries'] for e in entry.get('exceptions', []) if e.get('classification') == 'public_holiday'}
phase_checks = []
for p in calendar['academic_periods']:
    days = sorted(d for d in complete if p['from'] <= d < p['to'] and date.fromisoformat(d).weekday() < 5 and d not in holidays)
    if days:
        phase_checks.append({'from': p['from'], 'to': p['to'], 'count': len(days), 'meanKwh': sum(daily[d] for d in days) / len(days)})

evidence = run / 'outputs/evidence'
official = json.loads((evidence / 'official_totals.json').read_text(encoding='utf-8'))
monthly = json.loads((evidence / 'monthly_trend.json').read_text(encoding='utf-8'))
components = json.loads((evidence / 'circuits.json').read_text(encoding='utf-8'))
phases = json.loads((evidence / 'academic_phases.json').read_text(encoding='utf-8'))
checks = []
def check(label, actual, expected, tolerance=0.001):
    checks.append({'metric': label, 'actual': actual, 'expected': expected, 'pass': abs(actual - expected) <= tolerance})
check('officialTotalKwh', official['projectTotalKwh'], sum(totals.values()))
actual_floors = defaultdict(float)
for row in official['byFloorCategory']:
    actual_floors[row['level_node_id']] += row.get('usage_kwh', row.get('sum'))
for floor, value in floors.items():
    check('floor/' + floor, actual_floors[floor], value)
check('mayToJulyChangePct', monthly['mayToJulyChangePct'], 100 * (months['2026-07'] / months['2026-05'] - 1), 0.01)
for row in monthly['months']:
    month = row.get('month', row.get('date'))
    check('month/' + month, row['kwh'], months[month])
for field, meter in [('l7Load4Kwh', 'l7-load-4'), ('l7Load3Kwh', 'l7-load-3'), ('l6Load4Kwh', 'l6-load-4')]:
    check(field, components[field], circuits[meter])
phase_names = ['Teaching 1', 'Term break', 'Teaching 2', 'Study/exam']
for expected, name in zip(phase_checks, phase_names):
    actual = next(p for p in phases['phases'] if p['phase'] == name)
    check('phase/' + name + '/days', actual['count'], expected['count'], 0)
    check('phase/' + name + '/mean', actual['mean'], expected['meanKwh'])
out = {'inputSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'officialEnergyByQuality': dict(totals), 'floorKwh': dict(floors), 'monthKwh': dict(months), 'completeDays': len(complete), 'academicNonHolidayWeekdays': phase_checks, 'checks': checks, 'pass': all(c['pass'] for c in checks)}
package = json.loads((run / 'outputs/analysis-findings.json').read_text(encoding='utf-8'))
profile = next(e for e in package['evidence'] if e['id'] == 'ev-profile')
out['metadataIssues'] = []
expected_profile_samples = sum(p['count'] for p in phase_checks) * 24
if profile['sampleCount'] != expected_profile_samples:
    out['metadataIssues'].append({'metric': 'phase-profile day-hour sample count', 'actual': profile['sampleCount'], 'expected': expected_profile_samples, 'reason': '82 complete non-holiday weekdays x 24 hours; phase-hour aggregate has 96 points. The evidence must explicitly identify its sample unit.'})
out['numericChecksPass'] = out.pop('pass')
out['pass'] = out['numericChecksPass'] and not out['metadataIssues']
(run / 'independent-validation.json').write_text(json.dumps(out, indent=2), encoding='utf-8')
print(json.dumps(out, indent=2))
sys.exit(0 if out['pass'] else 1)


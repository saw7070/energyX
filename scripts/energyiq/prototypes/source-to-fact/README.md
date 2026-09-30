# PROTOTYPE: Ngee Ann Source-to-Fact Contract

> Throwaway terminal shell. The pure contract in `contract.mjs` is the candidate logic to absorb later; `prototype.mjs` is not production code.

## Question

Can the current Ngee Ann Excel import and a future Tuya API connector produce the same traceable cumulative-reading contract, actual-duration Interval Facts, Virtual Meter results and non-duplicating official aggregation without coupling Overview, Explorer or AI Analysis to the source format?

## Run

~~~powershell
npm run prototype:energy-source-facts
~~~

For a non-interactive evidence snapshot:

~~~powershell
npm run prototype:energy-source-facts -- --demo
~~~

Add `--view=v`, `--view=d` or `--view=e` to print the Virtual Meter, adapter/evidence or edge-case frame.

The prototype reads the two real Level 6 workbooks under `data/raw_excel/`. It keeps all state in memory and does not write a database or modify source files.

## Candidate contract

~~~mermaid
flowchart LR
    Excel[Excel Adapter<br/>exact Device Name] --> Batch[Import Batch<br/>SHA + coverage window]
    Tuya[Tuya Adapter<br/>device_id + DP] --> Batch
    Batch --> Raw[Raw Reading<br/>cumulative + source ref]
    Binding[Published Source Binding] --> Canonical[Canonical Reading]
    Raw --> Canonical
    Canonical --> Interval[Interval Fact<br/>delta + actual duration + quality]
    Interval --> Physical[Physical Meter Point]
    Interval --> Formula[Published linear formula]
    Formula --> Virtual[Virtual Meter Point]
    Physical --> Official[Official aggregation<br/>explicit sources only]
    Virtual -. default: analytical only .-> Analysis[Overview / Explorer / AI]
    Official --> Analysis
~~~

## Decisions exercised

- Raw cumulative readings and derived usage are separate records.
- An Import Batch is idempotent by artifact SHA.
- Overlapping batches use a deterministic canonical selection rule and retain conflicts as quality evidence.
- Gaps keep their actual duration and usable delta; resets produce no usage; neither condition is silent.
- `Virtual Load 12 = Load 1 + Load 2` aligns interval keys and marks missing inputs incomplete instead of zero-filling.
- Virtual Meter is a Meter Point, not a Tier, and is excluded from official totals unless explicitly configured otherwise.
- Excel and Tuya differ only in how they create the adapter batch and stable source key. All downstream logic is shared.

## Not decided by this prototype

- Database schema, migrations and transaction boundaries.
- Admin page layout and workflow.
- Formal Tuya authentication, pagination, retry and rate-limit behavior.
- General formula parser, arbitrary nesting or circular dependency handling.

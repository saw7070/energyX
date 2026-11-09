# SKTC setup: how the meters were added and how the floor layout was designed

Site: SKTC (client Seng Kang Town Council), Asia/Singapore. Done on 9 November 2026 on energyiq.hima.sg.
This updates the SKTC onboarding guide (prepared 6 November) with what was actually done.

## What we started from

- **SKTC's meter sheet** (`SKTC Power Meter Installed Mapping 06112026.xlsx`). A title row, then the headings
  **Block Number**, **Meter Name**, **Meter Device ID**, **Meter Tracking Location** and **Tuya App Energy Reading**.
  Each block (264F, 264E, 264C, 264A, 264B) is named once on its own row, with its meters listed under it: 19 meters in
  all. Below the meters the sheet lists the client's key questions (see the end of this record).
- **The Tuya cloud project** behind Access ID `84pd…fmar`, already connected under Facility → Live connection. It is
  the same cloud project as Tuya Office, so it holds 56 devices: SKTC's 19 meters, Tuya Office's 20 meters, 10 meters of
  another site (A18P, B2R–B11P, Incoming 3Phase) and 7 gateways.

## Adding the devices

1. Open **SKTC → Facility → Live connection**. Under **Start from Tuya**, the status box shows the connection and what
   Tuya holds: *Devices in Tuya 56 · Can be meters 49 (47 online, 2 offline) · Gateways 7 (all online)*. It also says
   that 20 devices are already read by another site (Tuya Office) and are left unticked.
2. Choose **Paste your device list**, then either paste the cells or load the sheet. To paste: in Excel, select from the
   **Block Number** heading row down to the last meter (*Playground Lighting x 4*), copy, and paste. To load: choose
   **Load an Excel or CSV file** and pick the `.xlsx` itself; the title above the headings and the key questions below
   the meters are skipped. (On 9 November the box still took only CSV files, so the `.xlsx` was greyed out in the file
   picker. A CSV copy of the sheet, `SKTC device list for EnergyX.csv`, was loaded instead; the box now takes `.xlsx`.)
   EnergyX reads:
   - the **Block Number** column as the block, and a row holding only a block (for example `264F`) as the block of the
     meters below it;
   - **Meter Name** as the meter name, **Meter Device ID** as the Tuya device, and **Meter Tracking Location** as what
     the meter powers;
   - nothing else (the daily kWh column is ignored).

   A name used in more than one block gets the block in front, so the two blocks' meters stay apart:
   *264F Emergency Lighting* and *264E Emergency Lighting*.
3. Choose **Check the list**. All 19 lines showed **Found**, each matching the device name in Tuya (for example
   *264F L1-L6A Blk common Area Lighting* → Tuya *264F L1-L6A Blk Common Area Lighting*). All were online except
   *Pavilion linkway 1*.
4. Choose **Connect 19 meters and fetch the last 7 days**. EnergyX reads the last 7 days from Tuya, creates one meter
   per line grouped by block, connects each meter to its device and turns on the daily update at 02:00.

### What went wrong the first time, and the fix

The first **Connect** saved the meters but could not make them live:
`ENERGYIQ_PROJECT_DATA_NOT_READY:INVALID_INTERVAL_DURATION,NEGATIVE_INTERVAL_DELTAS`.

SKTC's lighting meters use little power, so Tuya logs their running total only when it moves: about hourly at night,
sometimes twice a few minutes apart, nothing for 11–12 hours in the day, and a few 0.01 kWh steps back (three meters went
from 0.02–0.04 to 0 when they were commissioned on 3 November). Start from Tuya used to turn Tuya's readings into a
plain readings file, which is checked like a meter-app export: uneven spacing and any step back block the site. The
daily Tuya update imports the same readings as Tuya readings, which are spread onto 15-minute intervals.

Release `e43bd15` (PR saw7070/energyX#21) makes Start from Tuya import Tuya's readings the same way as the daily
update, and publish only the import it just made, so the readings left from the failed attempt do not count. After that
release, **Connect 19 meters** was run again.

The second **Connect** worked: *19 meters created and connected to Tuya*. Checked on the server afterwards:

- SKTC is published with 19 meters, each connected to its Tuya device (19 of 19 matched).
- The last 7 days came in through the Tuya import, and the catch-up updates after it succeeded.
- The daily update is on at 02:00 Singapore time.
- Facility → Floor layout groups the meters by block (264F, 264E, 264C, 264A, 264B), ready to be drawn (next section).

### The meters

| Block | Meter | What it tracks |
| --- | --- | --- |
| 264F | 264F L1-L6A Blk common Area Lighting | Block common area lighting 1 |
| 264F | 264F Level 2-lvl17 Common Area Lighting | Block common area lighting 2 |
| 264F | 264F Emergency Lighting | Block emergency lighting |
| 264F | 264F GF Decorative Light | Ground floor decorative lighting |
| 264F | 264F RA-RB Lighting | Ground floor lift lobby lighting 1 |
| 264F | 264F GF Lobby Lighting | Ground floor lift lobby lighting 2 |
| 264F | Compassvale Bow Entrance Lighting | Project entrance lighting |
| 264E | 264E L1-L6A Blk common Area Lighting | Block common area lighting 1 |
| 264E | 264E Level 2-lvl17 Common Area Lighting | Block common area lighting 2 |
| 264E | 264E Emergency Lighting | Block emergency lighting |
| 264E | 264E GF Decorative Light | Ground floor decorative lighting |
| 264E | 264E RA-RB Lighting | Ground floor lift lobby lighting 1 |
| 264E | 264E GF Lobby Lighting | Ground floor lift lobby lighting 2 |
| 264E | Rubbish Strret Lamp | Driveway rubbish chute street lamp |
| 264C | Driveway Lamp Pole Light | Driveway street lamp |
| 264A | Pavilion DL & Fan | Pavilion downlight and fan |
| 264A | Pavilion linkway 1 | Pavilion walk path corridor light 1 |
| 264A | Pavilion linkway 2 | Pavilion walk path corridor light 2 |
| 264B | Playground Lighting x 4 | Playground lighting |

Names are exactly as in SKTC's sheet. *Rubbish Strret Lamp* keeps the sheet's spelling; rename it in Facility →
Devices if SKTC wants *Street*. *Pavilion DL & Fan* reads 0 kWh when nobody switches it on, which is expected.

## Designing the floor layout

SKTC did not send a drawing, only the meter sheet. The sheet already says where each meter is: its **block** and its
**Meter Tracking Location** (what and where it lights). So the floor layout is a **schematic site map, not to scale**:
one area per block, one room per tracking location, and each meter placed in its room. It can be replaced by a real
plan later if SKTC sends one.

### How it was laid out

The plan is drawn on a 1000 × 760 grid (Facility → Floor layout scales it to the screen).

| Area (block) | Where on the plan | Rooms in it | Meters |
| --- | --- | --- | --- |
| 264F | Left column, full height | Corridors L1–L17 · GF lift lobby · GF decorative · Emergency lighting · Compassvale Bow entrance | 7 |
| 264E | Middle column, full height | Corridors L1–L17 · GF lift lobby · GF decorative · Emergency lighting · Rubbish chute lamp | 7 |
| 264C | Right, top | Driveway | 1 |
| 264A | Right, middle | Pavilion · Pavilion linkway | 3 |
| 264B | Right, bottom | Playground | 1 |

- **Why this shape.** 264F and 264E are the two residential blocks with seven meters each, so they get tall columns side
  by side, which makes block-against-block comparison (one of SKTC's questions) easy to read. 264C, 264A and 264B hold
  only common-area lighting, so they are stacked on the right.
- **Areas are tied to the blocks.** Each area is linked to its block's location (264F, 264E, …) that Start from Tuya
  created, so an area shows the same total as the block in the rest of EnergyX.
- **Rooms follow the sheet.** Both common-area lighting meters of a block (*L1-L6A* and *Level 2-lvl17*) light the
  corridors, so they share *Corridors L1–L17*. *RA-RB Lighting* and *GF Lobby Lighting* are both ground-floor lift lobby
  lighting, so they share *GF lift lobby*. Every other meter has a room of its own. Rooms span the full width of their
  area so the names do not overlap.
- **Entrance.** The *Compassvale Bow entrance* marker sits below 264F, by the entrance lighting meter.
- **Meters.** All 19 meters are placed in their rooms (Floor layout shows 19 of 19 placed). Hovering a meter shows its
  name and latest use.

### How it was saved, and how to change it

The layout is saved in **Project notes** under *Floor layout*, which is where Facility → Floor layout reads it from and
what the advisor uses to describe where energy is used. *All changes are live* showed after saving.

To change it: **Facility → Floor layout → Edit layout**. Drag an area or room to move it and pull a corner to resize;
**+ Area**, **+ Room** and **+ Entrance** add more; drag a meter to its exact spot. **Place the rest in their board's
area** puts any new meter in the room its name mentions. Choose **Save layout**; the plan, Project notes and the advisor
update straight away. The same steps are in the user guide under *Draw the floor plan and place devices*.

## Client's key questions (from the sheet)

Suggested for Project notes, so the advisor answers them in SKTC's reports. **Not added yet**: add them once SKTC is
happy with the wording.

1. Total energy per month, broken down by day, and the utility cost at the tariff rate.
2. Energy per month for 264F, 264E and the common areas, as a pie chart.
3. Within each block, a pie chart of which circuit uses the most energy (%).
4. Block against block comparison.
5. The average 24-hour profile, and anything abnormal in it.
6. Whether the pavilion downlight and fan are used at all.
7. Average energy per lighting point per day.
8. An energy saving projection.

## Still to do for SKTC

- Operating hours, holidays (26 already set) and the electricity rate from SKTC's latest bill, so after-hours use and
  costs are worked out.
- Invite SKTC's users with the right roles, and set up weekly or monthly report emails.
- Add the key questions above to Project notes.
- Rename *Rubbish Strret Lamp* to *Rubbish Street Lamp* if SKTC wants (Facility → Devices).
- The next morning: check Data availability and System health show the 02:00 daily update arrived.

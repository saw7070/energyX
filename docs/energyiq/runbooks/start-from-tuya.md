# Start a site from Tuya

A site with no meters yet can be set up straight from its Tuya account, with no readings file: Facility → Live
connection → **Start from Tuya**. EnergyX reads the chosen meters' last 7 days from Tuya (Tuya keeps about 7 days),
creates one meter per device, publishes the readings, matches each meter to its device and turns on the daily update.

Before starting, the Tuya cloud project must be able to see the devices: on platform.tuya.com, open the cloud project →
Devices → Link App Account, and scan the QR code with the Tuya or Smart Life app that holds the meters. The project's
IoT Core service must be active. Enter the project's Access ID and Access Secret in EnergyX yourself; never send them
over chat or email.

Once connected, a status box shows the Access ID and what the account holds: all devices, the ones that can be meters
(online and offline), gateways (offline ones are named, since meters behind them cannot send readings) and how many are
ticked. **Refresh list** asks Tuya again and keeps the ticks.

One Tuya cloud project can hold several sites' devices (SKTC's account also holds all of Tuya Office's meters). A device
another site already reads, through its own live connection or the server settings, is marked **Connected to another
site** (or the site's name when it belongs to the same client) and is left unticked; bulk ticking skips it. Devices of
a site with no live connection cannot be recognised, so check the list.

There are two ways to choose the meters.

## Tick devices from Tuya's list

EnergyX lists the account's devices (gateways are left out). Tick the ones that are meters. Meter names are the Tuya
device names; rename them later if needed.

The search box filters by name, device type or online / offline (every word must match). Pasting device IDs (one, or a
column copied from Excel) shows exactly those devices, lists the IDs the account does not have and flags gateways;
**Tick only these N** then ticks exactly that list.

## Connect from a device list

Use this when the site gives you its own list, for example 20 meters across blocks 264E and 264F. Choose **Paste your
device list** and paste the cells copied from Excel, or load a CSV file. One meter per line:

| Column | Needed | Example |
| --- | --- | --- |
| Meter name | yes | `264E Lighting L1` |
| Tuya device ID | yes | `bf0123456789abcdef01` |
| Block or area | no | `264E` |
| What it powers | no | `Corridor lights` |

A header row is fine and the columns can be in any order when it names them (Device Name, Device ID, Block, What it
powers; also Meter Name, Meter Device ID, Block Number and Meter Tracking Location); without a header the order above
is used, and other columns such as daily readings are ignored. A sheet that names each block once, on its own row above
that block's meters, works as it is: with a block column, a row holding only the block sets it for the meters below. A
name used in more than one block gets the block in front ("264F Emergency Lighting") so meters stay tell-apart. **Check the list** asks Tuya about every ID and shows, per line,
whether the device was found, is not in this account, is a gateway, is listed twice, or is missing a name or a valid
ID. Lines not found are left out; fix the IDs or link the app account that holds them, then check again.

**Connect N meters** then runs the same steps as above, with the list's names as the meter names ("264E Lighting L1 ·
Corridor lights" when the list says what it powers). When lines have a block or area, the site is grouped into one
location per block with its meters below it; meters without one go on the main board. Every meter adds up to its block
and to the site; no meter is treated as an incoming total.

Device IDs are on the cloud project's Devices page, or in the Tuya app: open the device → ✎ → Device information →
Virtual ID. The browser only ever sends the IDs you typed; EnergyX sends back opaque references, not device IDs. To find
pasted IDs in the tick list, the browser derives the same reference from each ID (`liveDeviceRefFor`, matching the
server's `liveDeviceRef`), so device IDs are still never sent to the browser.

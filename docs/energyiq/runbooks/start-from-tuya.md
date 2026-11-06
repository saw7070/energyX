# Start a site from Tuya

A site with no meters yet can be set up straight from its Tuya account, with no readings file: Facility → Live
connection → **Start from Tuya**. EnergyX reads the chosen meters' last 7 days from Tuya (Tuya keeps about 7 days),
creates one meter per device, publishes the readings, matches each meter to its device and turns on the daily update.

Before starting, the Tuya cloud project must be able to see the devices: on platform.tuya.com, open the cloud project →
Devices → Link App Account, and scan the QR code with the Tuya or Smart Life app that holds the meters. The project's
IoT Core service must be active. Enter the project's Access ID and Access Secret in EnergyX yourself; never send them
over chat or email.

There are two ways to choose the meters.

## Tick devices from Tuya's list

EnergyX lists the account's devices (gateways are left out). Tick the ones that are meters. Meter names are the Tuya
device names; rename them later if needed.

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
powers); without a header the order above is used. **Check the list** asks Tuya about every ID and shows, per line,
whether the device was found, is not in this account, is a gateway, is listed twice, or is missing a name or a valid
ID. Lines not found are left out; fix the IDs or link the app account that holds them, then check again.

**Connect N meters** then runs the same steps as above, with the list's names as the meter names ("264E Lighting L1 ·
Corridor lights" when the list says what it powers). When lines have a block or area, the site is grouped into one
location per block with its meters below it; meters without one go on the main board. Every meter adds up to its block
and to the site; no meter is treated as an incoming total.

Device IDs are on the cloud project's Devices page, or in the Tuya app: open the device → ✎ → Device information →
Virtual ID. The browser only ever sends the IDs you typed; EnergyX sends back opaque references, not device IDs.

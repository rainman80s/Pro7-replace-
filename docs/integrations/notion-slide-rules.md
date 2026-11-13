# How your Notion page becomes slides (for pastors)

Reach Presenter reads the **Services** page for the Sunday (same date as the Planning Center plan) and makes the slides
for the "Message" slot. Write the page the way you already do — these rules match the template's own reminders.

## The rules
1. **A divider line (`/div`) starts a new slide.** Everything between two dividers is one slide. Empty slides are skipped.
   (No dividers on the page? Then every Heading 1/2 starts a new slide.) A line that is just `---` or `[slide]` also works.
2. **Heading 1** on its own = a big title slide ("1. SEE HIS FACE").
3. **Heading 2 + Heading 3s** (or Heading 2s under a Heading 2) = a point slide: title + points.
4. **Scripture:** a line that is only a reference — `Revelation 2:18-29 (ESV)` — followed by the pasted text makes a
   scripture slide with that reference. **Bold** in scripture shows as <u>underline</u> on Sunday. Several reference +
   text pairs between two dividers stay together on one slide. Long passages are split across slides automatically.
5. **A reference with nothing after it** (`Acts 16:14`) is filled in from the Bible for you. No translation written =
   **CSB** (your template's rule); if a translation isn't installed on the computer, the fill translation (BSB by
   default) is used and the operator is told.
6. **Quotes:** a paragraph in “quotation marks” (or a quote block) followed by a short line with the author = quote slide.
7. **Bulleted / numbered lists** = points. Add a Notion comment saying **"one at a time"** to reveal them one by one.
8. **Images** = their own full-screen slide (downloaded into the workspace, so they still work offline).
9. **Comments** on any text = notes for the slide operator (shown on the stage display / operator view, not on screen).
   A toggle called **Notes** (or any other toggle) = notes too; a toggle called **Slides** shows its contents as slides.
10. The template's instruction blocks (synced blocks), child pages and tables are ignored.

## Edits after import
Change the page any time. In Reach: **Fill from Notion** / Preview → it lists only the slides that changed. Slides the
operator restyled are never overwritten without asking.

## Announcements ("Sunday Highlights" in Comms Channels)
`# Slide 1` → image → `HEADING: …` → `DETAILS:` with bullets, repeated; then a divider and **Talking Points** (bold
headline per announcement). Each Slide N becomes one announcement slide (image as background, heading + details), the
talking points become that slide's operator notes, and the loop auto-advances (10 s, configurable).

## Setup (once)
notion.so/profile/integrations → New integration "Reach Presenter" (Internal; capabilities Read content + Read
comments) → copy the secret into Integrations → Notion → share the **Services** and **Comms Channels** databases with it
(••• → Connections). Databases and properties are auto-detected (Services: `Date`, `Speaker`, `Type` contains "Sunday
Service"; Comms Channels: title contains "Highlight", skip `Scrapped/Missed`) and can be changed in *Databases & rules*.
Notion API: version 2022-06-28, 3 req/s, cursor pagination, nested children, expiring file URLs downloaded immediately.

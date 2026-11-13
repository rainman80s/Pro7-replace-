# How Reach actually structures Planning Center and Notion

Learned on 2026-11-12 by reading (read-only) the connected Planning Center Services and Notion accounts.
**Structure only** — names, sermon text and contact details are deliberately not recorded; examples are anonymised.
Figma: the connector confirmed a "Reach Church" Pro team exists; no files were opened.

## Planning Center Services

### Service types (8)
`*Churchwide Gatherings` is the Sunday service type (the leading `*` sorts it first). Others: Communications Team,
Trail Life, Sunday Serve Teams - Ops, Reach Kids, Reach Youth, a 20s&30s type, Midweek Prayer.
All use only the standard item types (Header / Song / Media / Item) — no custom item types.
→ The app auto-selects the service type whose name contains "gathering" / "sunday" / "worship" (or sequence 0) and remembers the choice.

### Plans
- `title` is filled in and reads `"<Sermon title> / <Passage>"`, e.g. `"Ephesus / Revelation 2:1-7"`.
- `series_title` is filled in (series relationship present).
- `sort_date` = first service time (UTC). `dates` = `"November 15, 2026"`.
- Plans exist ~9 weeks ahead. Far-future plans are template-bloated (140–250 items, i.e. multiple copies of the template);
  the current week is trimmed to ~22 items. → never assume a small page; paginate (per_page=100).
- Plan times per plan (6–8): 1 `rehearsal` (midweek), 3 `other` (call time, pre-service prayer, rundown),
  2–4 `service` times with `name: null` (two gatherings, ~2h apart; some weeks have 4 overlapping entries
  = a second room/venue starting 15 min later). → countdown suggestion uses each distinct `service` start; unnamed
  times are labelled by clock time ("9:00 Gathering").

### Plan items (a typical Sunday, 22 items)
```
header  Pre-Gathering
item    Preservice Prayer            900s   service_position: pre
item    Service Run-Thru             180s   pre
item    Mic Check                     60s   pre
item    Preservice Music               0s   pre      note[Sound]: playlist name
header  Worship + Welcome
item    Call To Worship              120s            note[Person]: <first name>
song    <Song A>   key C  324s   song.ccli_number, arrangement.name, key.starting_key   note[Person]: <leader>
song    <Song B>   key C  330s
song    <Song C>   key C  365s   html_details: band note (rich text)
item    Welcome + Vision + Bless Kids 150s           note[Person]
item    Greeting (Pass The Peace)    180s            note[Sound]
header  Announcements + Story
item    Announcements                180s            note[Person]
header  Teaching
item    Message                     1800s            note[Person]: <speaker>, note[Sound]: mic type
item    Closing Prayer               120s            note[Person]
header  Response + Benediction
item    Leadership Announcement      600s            note[Person]: group name
item    Benediction                   60s            note[Person]
header  Post-Gathering
item    Postservice Music              0s   post     note[Sound]
```
Key facts the integration relies on:
- `item_type` ∈ `header | song | item` (media type available but unused that week). `service_position` ∈ `pre | during | post`.
- **Who leads each item is an ItemNote in the category named `Person`** (free text, usually a first name or a group).
  A second category `Sound` carries audio notes. → per-item `people` come from the `Person` note category
  (configurable list of category names; default `Person, People, Leader, Speaker, Who`), other categories become `notes`
  prefixed with the category ("Sound: Lapel").
- `description` is usually null; `html_details` occasionally holds a rich-text band note → stripped to text into `notes`.
- `custom_arrangement_sequence` is null (the arrangement's own sequence is used).
- Songs include `song` (title, author, ccli_number, copyright), `arrangement` (name, bpm, meter, length, chord_chart_key), `key` (starting_key).
- Item titles are stable week to week: `Message`, `Announcements`, `Call To Worship`, `Benediction`, `Welcome…`.
  → typed placeholders by title keyword: message/sermon/teaching → `sermon`; announcement/highlight → `announcements`;
  video/bumper → `media`; scripture/call to worship/benediction/reading → `scripture`; else `generic`.
  `pre`/`post` items are imported but collapsed under their header and flagged `servicePosition`.

### Plan people (≈45 per plan, 9 teams)
Teams: Sunday Service Roles, Music Leaders, Band, Production Crew, Sound, Welcome Team, Coffee Team, Set Up Team, Tear Down.
The team **"Sunday Service Roles"** has positions that map straight onto plan items:
`Speaker`, `Announcements`, `Service Host`, `Call To Worship`, `Benediction`, `Pre-Service Prayer Leader`.
Music Leaders: `Worship Leader`, `Music Director`, `Female Lead`. Production Crew: `Media Ops`, `Broadcast Director`, `Lights + Camera…`, `Photography`.
Statuses: confirmed / unconfirmed / declined (C/U/D).
→ Plan-level "who's on" = non-declined people in positions matching speaker/host/worship leader/announcements/benediction/call to worship;
  when an item has no `Person` note, the position whose name matches the item title fills `people` (e.g. item "Benediction" ← position "Benediction";
  item "Message" ← position "Speaker").

## Notion

### "Services" database (one page per gathering) — the sermon source
Properties: `Text and Passage Description` (**title**; identical to the PCO plan title, e.g. `"Ephesus / Revelation 2:1-7"`),
`Date` (date, no time), `Speaker` (people), `Type` (multi-select: Sunday Service, Worship Night, Child Dedications, Baptism, Special Events, No Service, Mid-Week PW),
`Series (Project Database)` (relation, limit 1), `Preferred Sermon` (select: 1st / 2nd / 11:00am Service), `Publishing Title` (text),
`Descriptor` (text), `Notes` (text), `Events + Comms` (relation), three rollups.
→ auto-mapping: date=`Date`, title=title property, speaker=first people property named like speaker, series=relation/select named like series,
  type filter = `Type` contains "Sunday Service". Match to a playlist by **date**, tie-break by title similarity to the PCO plan title.

Page body (from the database template):
1. synced block: H1 "Reflection Comments" + callout — *boilerplate*
2. two child pages (retro questions) — *ignored*
3. synced block: H1 "Sermon Slide Requests", an H3 deadline line, a callout with toggles of formatting reminders — *boilerplate*
4. the pastor's slide content, which follows the staff's own written convention:
   - **a divider separates slides** (their rule #1)
   - **H1 = main point** (3–6 words), **H3 = secondary point**; H2 is also used for section/point lists
   - scripture is written as a paragraph that is only a reference with a translation in parentheses — `Book 2:18-29 (ESV)` —
     followed by one or more paragraphs with the **pasted passage text** (inline verse numbers, bold = emphasis; staff note says
     Sunday slides show emphasis as underline). A slide can hold several reference+text pairs.
   - "All scripture is assumed CSB unless marked otherwise" → default translation is a setting (CSB), per-reference override via the parenthesis.
   - a reference with no text after it means "build it from the Bible".
   - quotes: a paragraph in quotation marks followed by a short attribution paragraph.
   - progressive reveals are typed out as repeated slides (same H2, growing list of H3s).
   - images are image blocks (Notion-hosted, expiring URLs), usually alone on a slide.
   - **operator notes are Notion comments** on the text (e.g. "one at a time" on a list) — not body text.
   - empty slides (two dividers in a row, empty paragraphs) are common and must be skipped.
   - a responsive reading ("Leader: … / Church: …") appears as a two-line paragraph.
→ converter mode `dividers` (default when the page contains dividers): content starts after the last boilerplate synced block;
  everything between two dividers is one slide; see `docs/integrations/notion-slide-rules.md`.

### "Comms Channels" database — the announcements source
Properties: `Name` (title, e.g. "Sunday Highlights"), `Date` (date = the Sunday), `Status` (status: Planning, Content Planned, Posted/Scheduled, Scrapped/Missed),
`Channel` (multi-select: Email, Socials Story, Socials Image(s), Socials Video, Sunday Video, **Sunday Highlight**, Clearstream / App), `Speaker` (people), `Owner` (person).
→ announcements = rows where `Channel` contains "Sunday Highlight" (or the title contains "Sunday Highlight") and `Date` = the service date, status not Scrapped.

Page body of a "Sunday Highlights" page:
```
# Slide 1                      ← H1 "Slide N" starts a slide
<image>                        ← background/feature image (Notion-hosted)
- **HEADING: <title>**         ← bullet with "HEADING:" → slide title
- **DETAILS:**                 ← bullet with nested bullets → body lines
  - <line>
  - <line>
# Slide 2 …
---                            ← divider ends the slides
*Talking Points*               ← everything after = presenter talking points (bold caps heading per announcement + bullets)
```
→ converter mode `announcement`: one slide per `Slide N` heading; `HEADING:`/`DETAILS:` labels stripped; talking-point sections are
  matched to slides by heading text and stored in `slide.notes` (stage display).

### "Events + Comms" database (request intake; related to Services)
Properties include `Request Name` (title), `Event/Comm Date`, `Comms Timeline`, `Description/Copy`, `Link`, `Priority`, `Status`, `Type`, `Related Service(s)`.
Not used for slides directly (the curated "Sunday Highlights" page is the source of truth), but offered as a fallback announcements source
(one slide per row: title + Description/Copy + date).

## Mapping summary
| Reach today | Reach Presenter |
|---|---|
| PCO `*Churchwide Gatherings` plan for Sunday | Playlist (`source.type='pco'`), headers/items/lengths/keys/people |
| ItemNote category `Person` | `PlaylistItem.people` |
| PCO item "Message" | placeholder `hint:'sermon'` → filled from Notion Services page with the same date |
| PCO item "Announcements" | placeholder `hint:'announcements'` → filled from Comms Channels "Sunday Highlight" page for that date |
| Notion divider-separated sermon page | slides; reference paragraphs → scripture slides (pasted text kept, else fetched) |
| Notion comments | `slide.notes` for the operator |

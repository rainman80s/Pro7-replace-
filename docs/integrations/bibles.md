# Bibles

## Offline (stored in the workspace → every computer, works offline)
Downloaded as whole translations from the Free Use Bible API (https://bible.helloao.org, a public-domain/open-licence
Bible JSON service — no scraping) into `<workspace>/bibles/<ID>.json` (compact `books[USFM][chapter][verse]`).

| Translation | Licence (verified Nov 2026) |
|---|---|
| BSB — Berean Standard Bible | Public domain — dedicated to the public domain by the Berean Bible translators on 30 April 2023 (berean.bible); attribution not required |
| WEB — World English Bible (ENGWEBP) | Public domain (ebible.org) |
| KJV — King James (eng_kjv) | Public domain worldwide except the UK, where Crown letters patent apply |
| ASV 1901 | Public domain |
| Reina Valera 1909 (Spanish) | Public domain |
| "More…" | only translations the catalogue marks `publicDomain: true` |

## Licensed translations (bring your own key; online, cached within terms)
| Provider | Keys | Terms we enforce |
|---|---|---|
| **ESV API** (Crossway) — https://api.esv.org | free for churches / non-commercial | ≤500 verses per request and ≤500 verses cached on disk; copyright line *"Scripture quotations are from the ESV® Bible… Used by permission."* on the last slide; "ESV" next to the text |
| **API.Bible** (American Bible Society) — https://scripture.api.bible | free starter key | each Bible's `copyright` string shown on the last slide; ≤500 verses cached. **TODO:** API.Bible asks apps to report Fair-Use (FUMS) views; we don't yet send FUMS beacons — add before wide use. NIV/NLT/CSB availability depends on what the publisher licenses to your key. |

Not included: YouVersion/Bible.com and Bible Gateway (no public API for presentation use; their sites must not be
scraped). If YouVersion's developer platform opens presentation licensing, add it as another `BibleProvider`.

## Reference parser (`src/shared/bible.ts`)
All 66 books, names/abbreviations/unique prefixes, ordinals (I/1st/First), `jn 3 16-18`, `Matt 1 2 3`, `Gen 1:1-2:3`,
`John 3:16,18,20-22`, `Ps 23; John 1:1`, single-chapter books (`Jude 5`), `vv.`, `a/b` suffixes, translations
`(ESV)`/`NIV`. ~100 test cases in `tests/bible-ref.test.ts`.

## Bible view
Type a reference (or words to search the offline text), pick translation + optional side-by-side translation (role
`translation`), verses per slide or fit-by-length, verse numbers, reference placement; live preview; **Show now**
(`live.showSlide`), **Add to service**, **Save to library** (kind `scripture`). Themes restyle roles `body`, `reference`,
`translation`, `caption` (copyright).

# Reach brand — quick reference (from REACH_BRAND_GUIDE.pdf, v1.0 2025)

**Feel:** organic, warm, lived-in — "a familiar family photo album". Welcoming, quietly confident, never techy/electric.

## Colors
| Name | Hex | Use |
|---|---|---|
| Charcoal | `#292929` | anchor / dark backgrounds (tints 20–80% allowed sparingly) |
| Lakeside | `#3886CE` | accent — sparingly, purposefully |
| Mustard Seed | `#E6A20F` | accent — sparingly, purposefully |
| Paper | `#F4F2EB` (sampled; the guide's printed hex for Paper is a typo) | calm foundation |
| White | `#FFFFFF` | calm foundation |

Rules: simple high-contrast pairings. On Charcoal, use White/Paper for text and graphics; do NOT overload dark layouts
with Lakeside/Mustard blocks ("drifts tech-driven"). Logo: Charcoal/Lakeside/Mustard on White/Paper, or White/Paper on Charcoal.
Never Lakeside/Mustard logo on Charcoal; never White-on-Paper.

## Logos
- **Primary wordmark**: "Reach" set in Perfectly Nineties Semibold.
- **Secondary icon — the "Window R"**: four-pane window-shaped R (PDF page 8; measurements page 11).
- **Combo mark**: vertical lockup only (icon above wordmark). The horizontal lockup is explicitly "avoid".
- Clear space ≥ 1× the height of the "R" on all sides.
- Vector art is in the PDF (pages 7–9, 11) — extract with `pdftocairo -svg`.

## Typography
| Role | Typeface | Notes |
|---|---|---|
| Display | Perfectly Nineties Regular (Semibold only in the wordmark) | titles, headlines |
| Subtitle / utility | TAY Birdie | section titles, nav, CTAs — uppercase, wide tracking in the guide |
| Body | Courier Prime (OFL — free to bundle) | typed, journal feel |
| Accent | Marina Script | handwritten, used sparingly |

Perfectly Nineties, TAY Birdie and Marina Script are commercial fonts: do not extract them from the PDF. The app references them
via `local()` (they're installed on Reach's Macs) with graceful fallbacks; licensed files can be dropped into
`src/renderer/public/fonts/`.

Section numerals in the guide: Mustard on Charcoal chips, TAY Birdie caps. Photography: warm, candid, film-like.

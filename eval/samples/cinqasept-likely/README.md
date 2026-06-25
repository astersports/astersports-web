# Cinq à Sept + LIKELY — real-garment eval set

Fixed real-garment eval set for the density/scale work (CLAUDE.md §4 G3, broadened in
`docs/DENSITY_SCALE_STRATEGY.txt` §5). Client = **Jaya Apparel Group**, brands
**Cinq à Sept** (cinqasept.nyc) and **LIKELY** (likely.nyc). 14 product images,
both brands, across the four surface buckets, flat-lay + on-model.

## Why this set exists
A synthetic-only "pass" does not count for G3 — a route must pass on **real pieces from
this client's catalog** before it can bill. This set is that fixed ground. Calibrate
against the whole set, never one cherry-picked photo.

## Buckets (see strategy doc §0)
| bucket | meaning | density/scale relevance |
|--------|---------|-------------------------|
| `scattered` (6) | all-over tossed/trailing prints + discrete-motif prints (florals, polka dots) | **density's sweet spot** — count motifs, remove an exact fraction; this is the P1 target |
| `embellished` (3) | placed sequins / paillettes / crystal trim | hard case — hybrid (deterministic count + masked generative finish), P3 |
| `solid` (2) | plain ground | **out of scope** — UI must not offer scale/density (nothing to count/scale) |
| `lace` (3) | lace / crochet / eyelet | bucket D |

The two cleanest count-demo pieces are the LIKELY **Poppette** (black dots on grey) and
**Tessa** (scattered roses on a dark ground): discrete, high-contrast, flat-lay.

## Provenance & durability
Every image is a public product-detail-page (PDP) image pulled from the brand's open
Shopify CDN via the `…/products.json` → `cdn.shopify.com` path. `manifest.json` records
per image: `brand`, `store`, `title`, `handle`, `bucket`, `view`, `sourceProductUrl`,
`sourceImageUrl`. Held for internal model-evaluation use only.

Image binaries are **gitignored by repo convention** (`eval/.gitignore` keeps
`*.jpg/*.png/*.webp` out of the repo). The durable, committed artifacts are
`manifest.json` + `fetch.mjs`; re-materialize the exact set with:

```
node eval/samples/cinqasept-likely/fetch.mjs
```

## Using it
`manifest.json` is the index. Note: the density eval harness
(`server/_core/studio/eval/densityEval.ts`) additionally needs, per image, a **fabric
truth-mask** and an **instance label-map** (one colour per motif). Those come from SAM2
(credentialed, gated) or hand authoring. For the high-contrast scattered pieces, the
eval-only offline segmenter (`eval/segmentMotifs.ts`) can generate an **approximate**
instance label-map without SAM2 — good enough to demo the 10/20/50% preview end-to-end,
to be validated against SAM2 on the credentialed run.

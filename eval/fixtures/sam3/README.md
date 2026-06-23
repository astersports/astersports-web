# SAM3 PCS Evaluation Test Set

## Structure

Each test case is a directory containing:
- `image.png` — the garment image (print/pattern)
- `ground_truth.json` — human-annotated instance data:
  ```json
  {
    "instanceCount": 42,
    "printType": "allover_floral",
    "instances": [
      { "id": 1, "bbox": [x, y, w, h], "maskFile": "masks/001.png" }
    ]
  }
  ```
- `masks/` — per-instance binary masks (white = instance, black = background)

## Required Balance (≥30 images)

| Print Type | Min Count | Description |
|---|---|---|
| dense_allover_floral | 8 | Dense repeating floral patterns |
| geometric_repeat | 8 | Geometric/tile repeats (stripes, checks, etc.) |
| scattered_tossed | 6 | Randomly placed motifs with varying density |
| placement | 4 | Large single/few motifs (chest prints, etc.) |
| border | 4 | Border/engineered prints |

## Ground Truth Annotation Guidelines

- Count every distinct motif instance (even partially occluded)
- Coarse masks acceptable for tossed class (bbox-tight is fine)
- For dense allover: count within a representative 512×512 crop
- Mark partially visible edge instances as "partial" in metadata

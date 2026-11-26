# Example oddball shapes

Three stimuli for `oddball_vep.html`, matched in drawn area and in extent. The
standard is a checkerboard; the deviant and the target are the Orlice eagle and
its mirror image, so everything that distinguishes them is orientation.

| File | Role | Bytes | SHA-256 (first 12) |
|---|---|---|---|
| `vepeagle_standard_checkerboard.svg` | standard | 435 | `c53ddc841c97` |
| `vepeagle_deviant_orlice_left.svg` | deviant | 9879 | `60de8167a94f` |
| `vepeagle_target_orlice_right.svg` | target | 9882 | `7a527cfb96f6` |

The hashes are of the files as stored here, not of the cleaned SVG the page
carries in the stimulus link.

## How they are matched

**Extent.** Each shape is drawn so that its ink bounding box is square in
continuous coordinates. Measured over ink heights of 28–220 px, all three fill
exactly the requested square:

| requested (px) | 28 | 34 | 40 | 48 | 60 | 72 | 100 | 150 | 220 |
|---|---|---|---|---|---|---|---|---|---|
| all three shapes | 28×28 | 34×34 | 40×40 | 48×48 | 60×60 | 72×72 | 100×100 | 150×150 | 220×220 |

**Area.** The suite reports the drawn area of each shape and warns when the
largest and the smallest differ by more than a factor of 1.05, because unequal
area means unequal emitted light.

The check size is not a free parameter here. A checkerboard centered on the
meeting point of four squares covers exactly half of its box whatever the check
size, because mirroring the pattern exchanges the dark and the light squares.
The eagle was therefore matched to the checkerboard rather than the other way
round: its outline was eroded slightly until the two agreed.

Measured on the files in this folder, drawn area as a fraction of h²:

| ink height (px) | 28 | 34 | 40 | 48 | 60 | 72 | 100 | 150 | 220 |
|---|---|---|---|---|---|---|---|---|---|
| checkerboard | 0.5000 | 0.5000 | 0.5000 | 0.5000 | 0.5000 | 0.5000 | 0.5000 | 0.5000 | 0.5000 |
| deviant | 0.5166 | 0.5078 | 0.5006 | 0.4970 | 0.5011 | 0.5012 | 0.5016 | 0.5005 | 0.5020 |
| target | 0.5102 | 0.5078 | 0.5006 | 0.4991 | 0.5019 | 0.5002 | 0.5007 | 0.5001 | 0.5017 |

The checkerboard is exactly half its box at every size: eight of sixteen equal
checks tile it. The eagle holds 0.497–0.502 from 40 px upwards and drifts to
0.517 at 28 px, where a single pixel is already a fifth of a percent of the
shape.

Drawn area, largest over smallest of the three shapes:

| ink height (px) | 28 | 34 | 40 | 48 | 60 | 72 | 100 | 150 | 220 |
|---|---|---|---|---|---|---|---|---|---|
| max / min | 1.033 | 1.016 | 1.001 | 1.006 | 1.004 | 1.002 | 1.003 | 1.001 | 1.004 |

Every size is below the 1.05 warning threshold, and above 40 px the three agree
to within half a percent.

**Deviant against target.** The target is the deviant with every x coordinate
replaced by 100 − x. Their area and extent are therefore equal by construction,
not by fitting. Rasterization can still place a boundary pixel differently on
the two, which is why the measured counts in the table above are not bit-identical.

That exactness is the point of the pair, and also its cost: mirror-image
discrimination is demanding, and at 2° it is more demanding still. If the task
turns out too hard, a less subtle target that keeps the matching is easy to
make — mirror only the head, or raise one wing. Check the drawn-area readout on
the page after any such edit.

## Two limits worth knowing before you set a size

**The checkerboard and the alpha threshold.** When the ink height in pixels is
a multiple of the number of checks across (four, here), every check is a whole
number of pixels and the dark area is exactly h² / 2. At any other height the
check boundaries fall on half-covered pixel rows whose alpha lands on the
threshold itself, and whether they are drawn depends on how the browser rounds.
Across heights of 24–240 px the dark area then ranges from 0.852 to 1.148 of
h² / 2, with the two roundings furthest apart at 26 px. This exceeds the 1.05
warning only for heights of 25–78 px, that is below roughly 3.2° on a display
of 24 pixels per degree. **Choosing a shape height that is a multiple of four
removes the effect entirely.**

**The eagle's talons.** The outline keeps the full heraldic detail, and the
talon tips connect to the body through necks only a few pixels wide. At 116 of
the 217 heights between 24 and 240 px the rendered mask is therefore not a
single connected region. The detached ink is a median of 0.02 % of the shape,
and it exceeds 2 % only below 32 px, where a whole talon tip can come loose.
This is cosmetic above about 1.3° and does not affect the drawn-area match, but
it is why the shape should not be presented very small.

## Use

Load each file into a stimulus slot on `oddball_vep.html` (*Load SVG…*). The
page cleans the file, measures the ink, reports the drawn area and carries the
SVG in the stimulus link and in the log, so a condition built from these shapes
reopens identically elsewhere.

The shapes are binary masks: the suite ignores the colors in the file and takes
everything with alpha ≥ 128. Stimulus color is set on the page, not here.

Give each active stimulus its own sync-dot color so an RGB photodiode can tell
them apart; the page refuses to start if two active stimuli share one.

## Provenance

The eagle outline was vectorized from a raster image generated with an
image-synthesis tool, then simplified and area-matched as described above. It is
distributed under the license in the repository root. The checkerboard is
generated from the geometry given above and has no external source.

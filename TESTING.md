# Reviewing the PM-SC dashboard

Thank you for taking the time to look at this. It is a showcase of sample
provenance for Precision Medicine Sample Central, and it exists so that we can
find out what is wrong with it before anyone builds the real thing.

This document walks you through the three views, tells you what to try in each,
and says what we would most like your opinion on. It should take around thirty
minutes if you follow it through, and rather less if you only look at the parts
that touch your own work.

---

## Before you start

**The data is invented.** Every patient, sample and date you see was generated
from the REDCap data dictionary. Nobody in it is real. The banner across the top
of the page says so, and it also tells you how many patients and samples the
cohort contains and the date the data is current to.

**What we want from you is not bug reports.** Those are welcome, but the more
valuable thing is disagreement. If a number is labelled in a way you would not
use, if a step in the process is in the wrong place, or if a view answers a
question nobody actually asks, that is what we need to hear.

**There is no login.** Anyone with the address can open it. That is deliberate
for a test round with synthetic data, and it will not be true of anything real.

**Which browser.** Chrome, Edge, Firefox or Safari are all fine. If you have a
choice, use a reasonably large window, because the graph view assumes room for a
sidebar on each side of the picture.

---

## How to send feedback

Anything you can tell us is better than nothing, but feedback we can act on
usually has these five parts. There is a blank copy at the end of this document
that you can paste into an email as many times as you need.

| Part | Example |
|---|---|
| Which view | The study dashboard. |
| What you did | Hovered over the QC pass rate tile. |
| What you expected | That it would tell me whether pending aliquots are counted. |
| What happened | The tooltip says they are excluded, but the cohort flow seems to count them. |
| How much it matters | Would mislead a reader, so it matters. |

For anything visual, a screenshot saves a great deal of correspondence. If your
comment is about the graph view, the export button described below produces a
picture with the filters and counts written underneath it, which tells us exactly
what you were looking at.

---

## View one, the workflow

Open the **Workflow** tab. This is the sample journey, drawn as a swimlane. Time
runs left to right, and each horizontal lane is a custodian, so a bar moving down
to a different lane is a handover from one team to another.

### What to try

1. Click any bar. The panel underneath changes to describe that step, giving its
   location, the system it is recorded in, who performs it, which identifier is
   assigned, how long it takes, and the REDCap field it is captured in.
2. Work through the eighteen steps in order, from enrolment to the molecular
   tumour board.
3. Look at the field labelled **Recorded in REDCap**. Where a step is not
   captured, it says "not captured" rather than leaving a gap.
4. Look at the panel on the right, which gives the total active handling time,
   the total elapsed time, and the median actually measured in the data.
5. Read the note at the bottom about the sample splitting into DNA, RNA and
   protein after the AllPrep step.

### What we would like to know

- Are the eighteen steps the right eighteen, in the right order?
- Is each step in the correct lane, meaning is the custodian right?
- Are the durations plausible for your site, and if not, which ones are wrong and
  in which direction?
- Is anything shown as "not captured" that you believe is in fact recorded
  somewhere, even outside REDCap?
- Is a step missing entirely?

---

## View two, the study dashboard

Open the **Study dashboard** tab. This is the cohort seen as numbers rather than
as a picture.

### What to try

1. Read the six tiles across the top, which are patients enrolled, samples,
   aliquots, QC pass rate, reached data back, and stalled samples.
2. **Hover over each tile.** Every one has a definition attached, and the
   definitions are the part most likely to be wrong. The stalled tile in
   particular tells you the number of days it uses.
3. In the sample types card, hover over the rows beside the ring to see each type
   picked out.
4. Read the bars to the right of it, which give the QC pass rate for each
   combination of sample type and molecule, with the rate and the underlying
   pass and fail counts.
5. Look at the time to tumour board strip, which splits the elapsed time by who
   controls each part of it.
6. Look at the cohort flow at the bottom, which shows where samples go and where
   they stop.
7. Scroll to the three panels at the very bottom, headed "Needs attention",
   "Cohort recruitment" and "Turnaround by site". They are deliberately empty.

### What we would like to know

- Are these the right six headline numbers? If you could swap one for something
  else, which would go and what would replace it?
- Do you agree with the definitions in the tooltips, especially the QC pass rate
  excluding aliquots that have not been assessed yet?
- The stalled figure currently uses a single threshold of thirty days for every
  stage. Is that reasonable, or does it need to differ by stage? Platform
  analysis legitimately takes weeks, which makes us doubt one flat number.
- **The three empty panels are a question for you.** They are held open rather
  than filled in because what belongs there is the study team's decision. What
  would you want to see in each?
- In the cohort flow, is the place where samples stop the place you would expect?

---

## View three, the knowledge graph

Open the **Knowledge graph** tab. This is the whole cohort as one connected
picture. It takes a moment to appear, because the layout is solved in three
dimensions before anything is drawn, and it reports its progress while it works.

The single most important thing to know is that **distance carries meaning**. One
patient's own samples are pulled tightly together, while anything shared between
patients, such as a platform, an operator or a freezer box, settles in the space
between the clumps. If two things are near each other, that is a claim the
picture is making, not an accident of drawing.

### Moving around

There is a **?** button at the edge of the canvas that lists these. It is worth
opening once.

| Gesture | What it does |
|---|---|
| Left-drag | Turns the graph, in the force layout |
| Right-drag | Moves the picture |
| Scroll or pinch | Zooms towards the pointer |
| Hover a node | Says what it is |
| Click a node | Selects it, and the spin pauses while you read |
| Double-click a node | Lights up its family |
| Right-click a node | Opens the full menu |
| The ⌖ button | Brings everything back to the middle |

### What to try

1. Let it finish settling, then **turn it**. The depth is real, and a picture
   that looks tangled from one angle often resolves from another.
2. Press **⏸ Rotation** to stop the spin. Rotation costs processor time, so if
   your machine sounds busy, this is why, and pausing hands it straight back.
3. Try each of the five layouts along the bottom, which are Force, Shell,
   Clustered, Grouped and Layered. Each one is a different claim about the same
   data, and the bar at the top tells you which claim is being made.
4. In the left sidebar, use the **eye** icon beside a node type to hide it, and
   the **sun** icon to light every one of that type at once.
5. Press the **ⓘ** beside a node type. It gives a plain description and the
   ontology term the type is anchored to.
6. Work down the filters in the left sidebar, covering patient sex, age band,
   sample type, molecule, QC outcome, processing step and deviations recorded at
   pathology. Watch the counts along the top change as you go.
7. **Right-click a sample** and choose "Trace the whole path". A window opens
   showing that sample's entire history on one time axis, and it can be saved as
   a picture. The same menu offers "Where did this come from" and "What became of
   it" if you only want one direction.
8. Select a node and read the panel on the right, which is the inspector.
9. Press the **⭳** button to export. It offers the current view exactly as it
   appears, or the whole graph framed in full with the layout, the counts and the
   active filters written underneath.

### What we would like to know

- Do the node type names match the words you use? The sidebar doubles as the
  colour key, so those names are the vocabulary of the whole view.
- Are the ontology anchors behind the ⓘ correct?
- Do all five layouts earn their place, or are some of them the same idea twice?
- Does the idea that distance means belonging actually come across when you look
  at it, or does it need to be said on screen?
- When you trace a sample's path, is anything missing from the story it tells?
- Is the inspector showing the fields you would want for the node you selected?

---

## Things that are already known, so please do not report them

These are real limitations that we have already identified. Telling us about them
does no harm, but you will not be telling us anything new. Opinions on how they
should be resolved are very welcome.

| What you will notice | Why it is like that |
|---|---|
| The proteomics row in the turnaround card says "no send date recorded" rather than giving a number. | The mass spectrometry run records a date the results came back but no date they were sent, so the wait cannot be calculated. We show the gap rather than hide the row. |
| Stalled samples use thirty days everywhere. | One threshold may not fit every stage. This is an open question and your view on it is wanted. |
| QC is a yield figure and a Pass or Fail tick, with nothing about quality. | The schema records concentration and total yield but no RIN, no DV200 and no purity ratio, so the application cannot say whether material was intact. This is the subject of a separate set of questions for the lab. |
| Sample types are FFPE, Tissue, Biopsy and Blood. | Earlier mockups guessed at a different set. These are the values actually in the data. |
| A repeat links one sample to another sample, rather than one aliquot to another. | In REDCap a repeat is a whole new record, so that is where the link belongs. |
| The graph makes the fan spin while it rotates. | Drawing seven hundred moving nodes is genuine work. Press ⏸ Rotation and it stops immediately. |
| There is no login. | Deliberate for this round, since the data is synthetic. |

---

## Feedback template

Copy this as many times as you need.

```
View:            (workflow / study dashboard / knowledge graph)
What I did:
What I expected:
What happened:
How much it matters:   blocks me / would mislead a reader / annoying / cosmetic / just an idea
Browser and screen:
```

If you would rather not write anything down, a conversation is fine too. The
things above are simply what we will end up asking you.

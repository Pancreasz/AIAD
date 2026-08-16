# MoCA Audio Recording Script

Everything the app needs recorded, with the exact words to say and how to say them.

**Where the files go:** `src/renderer/public/moca/audio/`
**Format:** MP3, mono. Sample rate doesn't matter much — anything from 22 kHz up is fine.
**Filenames must match exactly** — the app looks them up by name, and a typo shows up as a
playback error rather than a missing sound.

---

## Part 1 — Required now

Without these three files, Memory and Digit Span cannot run at all. Everything else in this
document is optional.

### 1. `memory-words.mp3` — REQUIRED

Read these five words:

> ## หน้า &nbsp;&nbsp; ผ้าไหม &nbsp;&nbsp; วัด &nbsp;&nbsp; มะลิ &nbsp;&nbsp; สีแดง

**How to read them:** one word per second, flat and even. Leave a clear one-second gap between
words. Do not group them, do not let your intonation rise or fall across the list, and do not
emphasise any word.

**Why it matters:** this is a memory-encoding task. Rhythm, grouping, or emphasis all make words
easier to remember, which would inflate the score relative to the published norms.

This same file plays twice — once for trial 1, once for trial 2. You only record it once.

### 2. `digits-forward.mp3` — REQUIRED

Read these five digits:

> ## ๒ &nbsp;&nbsp; ๑ &nbsp;&nbsp; ๘ &nbsp;&nbsp; ๕ &nbsp;&nbsp; ๔
>
> ### สอง — หนึ่ง — แปด — ห้า — สี่
>
> (2 – 1 – 8 – 5 – 4)

**How to read them:** exactly one digit per second, flat tone, no grouping.

Say each digit separately. Do **not** say "twenty-one, eighty-five" or any grouped form — digit
span measures how many independent items someone can hold, and chunking them into larger numbers
changes what is being measured.

### 3. `digits-backward.mp3` — REQUIRED

Read these three digits:

> ## ๗ &nbsp;&nbsp; ๔ &nbsp;&nbsp; ๒
>
> ### เจ็ด — สี่ — สอง
>
> (7 – 4 – 2)

**How to read them:** same as above — one digit per second, flat, ungrouped.

⚠️ **This is the easiest file to get wrong.** The patient hears **7 4 2** and must answer
**2 4 7**. Record the prompt, not the answer. If you record 2-4-7 by mistake, the subtest will
score every correct patient as wrong, and the mistake is invisible in the code — `subtests.js`
stores `'247'` because that is the expected *answer*.

---

## Part 2 — Optional: spoken instructions

The app already shows every instruction on screen in Thai and English. Recording them spoken is
optional, but it directly supports the project's central claim — *self-administered without a
clinician present* — because a patient with cognitive impairment may struggle to read on-screen
text reliably.

These are the exact strings already in `src/renderer/src/moca/subtests.js`. Nothing in the code
reads these files yet; wiring them up is a small follow-on change once they exist.

| Filename | Say this |
|---|---|
| `instr-naming.mp3` | คุณจะเห็นสัตว์สามชนิด หลังนับถอยหลัง ให้บอกชื่อสัตว์ทั้งสามโดยไม่หยุด |
| `instr-memory-1.mp3` | ตั้งใจฟังคำห้าคำ เมื่อจบแล้ว ให้พูดทวนให้ได้มากที่สุด |
| `instr-memory-2.mp3` | ฟังคำทั้งห้าอีกครั้ง แล้วพูดทวนให้ได้มากที่สุด |
| `instr-digit-forward.mp3` | ฟังตัวเลขต่อไปนี้ แล้วพูดทวนตามลำดับ |
| `instr-digit-backward.mp3` | ฟังตัวเลขต่อไปนี้ แล้วพูดทวนย้อนกลับ |
| `instr-serial-sevens.mp3` | เริ่มจาก 100 ให้ลบออกทีละ 7 แล้วลบ 7 จากคำตอบไปเรื่อย ๆ พูดคำตอบออกมาดัง ๆ |
| `instr-delayed-recall.mp3` | บอกคำทั้งห้าคำที่จำได้ให้มากที่สุด |
| `instr-orientation.mp3` | บอกวัน เดือน ปี วันที่ สถานที่ และจังหวัดในวันนี้ |

**How to read these:** normal conversational pace, warm and clear. Unlike the stimulus files
above, these are not measured — they are just instructions, so natural delivery is better than
metronomic.

⚠️ **`instr-serial-sevens.mp3` is the only one of these not yet recorded.** Serial 7s has no
stimulus file — the starting number is part of the instruction — so this single file is all the
subtest needs. Until it exists, Serial 7s reaches the error screen and can be skipped like any
other audio-dependent subtest.

### `countdown.mp3` — optional

> ### สาม — สอง — หนึ่ง
>
> (3 – 2 – 1)

The Naming subtest carries `countdownSec: 3` in its metadata. Nothing reads it yet — the timer
work is a separate piece — but a countdown recording (or three short beeps) will be wanted when
it lands.

---

## Recording tips

- **One take per file.** Don't record all three stimulus files in one long take and split them
  later; a stray breath at a boundary is easy to miss and hard to fix.
- **Trim leading and trailing silence.** The app opens the microphone the instant playback ends,
  so trailing silence becomes dead air where the patient may start speaking before recording
  begins.
- **Keep the volume consistent** across files. The patient hears these through whatever the demo
  laptop has; a quiet file may simply not be heard.
- **A phone recording is fine to start.** Placeholder audio unblocks all testing immediately and
  can be replaced with a clean take later. The digit timing rule is the only thing worth being
  strict about even in a placeholder, because sloppy timing changes what the subtest measures.
- **Use one voice throughout.** Switching speakers between subtests adds a variable you don't
  want when interpreting results.

---

## What happens if a file is missing

The app does not fail silently. Playback failure shows an error naming the missing file, with
**Retry** and **Skip this subtest** buttons. Skipping records the subtest as *not administered*
— it is not scored zero — and the results table marks the row `skipped` and notes that the total
is no longer comparable to the full 30-point scale.

So you can walk a complete session today, before recording anything, by skipping the three
audio-dependent subtests.

---

## Part 3 — Vigilance (built, needs audio)

Eleven files. The patient hears 29 digits at one per second and taps every time they hear **1**.

### `digit-0.mp3` … `digit-9.mp3`

One file per digit, one word each:

| File | Say | File | Say |
|---|---|---|---|
| `digit-0.mp3` | ศูนย์ | `digit-5.mp3` | ห้า |
| `digit-1.mp3` | หนึ่ง | `digit-6.mp3` | หก |
| `digit-2.mp3` | สอง | `digit-7.mp3` | เจ็ด |
| `digit-3.mp3` | สาม | `digit-8.mp3` | แปด |
| `digit-4.mp3` | สี่ | `digit-9.mp3` | เก้า |

**Aim for under 800 ms, and cut leading silence to nothing.** Unlike `digits-forward.mp3`, pacing
is not your job here — the app supplies the rhythm and plays these at exactly one per second. The
two ends of the file are not equally forgiving:

- **Leading silence is the one that corrupts scores.** It shifts the digit's real onset later than
  its scheduled one, and the app scores that difference as the patient's reaction time. Nothing in
  the app can detect or correct it. Cut it to zero.
- **Trailing length is now handled.** The player silences each digit the moment the next one
  starts, so a long file is truncated rather than allowed to sound over its neighbour. A file that
  overruns loses its own tail — which matters only if the word itself is still going.

The recordings currently in the folder run 1088–1344 ms with a ~21 ms lead-in: the onsets are
excellent, and the overruns are absorbed by the player. Re-trimming them is a quality improvement,
not a prerequisite.

`digit-7.mp3` (เจ็ด) is **not used** — the sequence contains no 7. Record it anyway; it is one
extra word, and it means a later correction to the sequence does not send you back to the
microphone for a single file.

### `instr-vigilance.mp3`

> คุณจะได้ยินตัวเลขหลายตัว ให้กดปุ่มเว้นวรรคทุกครั้งที่ได้ยินเลข 1

Normal conversational pace, like the other instruction files.

This names the **space bar**, not the on-screen button, and `instructionTextTh` in `subtests.js`
must say the same thing — a patient who hears one instruction and reads another has been given a
second task nobody meant to set. A key press also has no aiming component, so the latency the app
records is reaction time rather than reaction time plus target acquisition.

### The sequence itself is not recorded

```
5 2 1 3 9 4 1 1 8 0 6 2 1 5 1 9 4 5 1 1 1 4 1 9 0 5 1 1 2
```

The app plays it from the ten digit files at exact one-second onsets. It lives in `subtests.js`,
came from your paper form, and a single wrong digit changes every score the subtest produces
while looking completely normal — so **read it back against the form once.** The tests catch a
dropped or added digit; nothing but your eyes catches a transposed one.

---

## Audio needed by subtests not yet built

Not required now — listed so you can plan a single recording session rather than several.

- **Sentence repetition** (2 points) — the patient repeats two sentences read aloud, so both
  sentences need recording.

The sentences come from your Thai MoCA form; they are not in this repo. Pull them from the form
before your recording session if you want to capture everything at once.

Stimulus audio, served by Vite at /moca/audio/<name>.mp3

Required now:
  memory-words.mp3     หน้า ผ้าไหม วัด มะลิ สีแดง  (one word per second, flat tone)
  digits-forward.mp3   2 1 8 5 4                    (one digit per second, no grouping)
  digits-backward.mp3  7 4 2                        (the patient answers 247 - record the prompt)

Vigilance (11 files):
  digit-0.mp3 .. digit-9.mp3  one Thai word each, trimmed tight, under 800ms
  instr-vigilance.mp3         the spoken instruction
  The app schedules these at one per second - do not record the sequence itself.

Full recording script, including optional spoken instructions and how to read each file:
  docs/moca-audio-recording-script.md

These live here rather than in src/assets because they are referenced by URL,
not imported: a missing import would fail the build, while a missing file here
is a runtime error the app surfaces with Retry and Skip.

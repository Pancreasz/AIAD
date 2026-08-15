Stimulus audio, served by Vite at /moca/audio/<name>.mp3

  memory-words.mp3     หน้า ผ้าไหม วัด มะลิ สีแดง  (one word per second, flat tone)
  digits-forward.mp3   2 1 8 5 4                    (one digit per second, no grouping)
  digits-backward.mp3  7 4 2                        (the patient answers 247 - record the prompt)

These live here rather than in src/assets because they are referenced by URL,
not imported: a missing import would fail the build, while a missing file here
is a runtime error the app reports and offers to retry.

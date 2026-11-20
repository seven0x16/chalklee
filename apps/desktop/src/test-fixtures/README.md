# Desktop test fixtures

These fixtures contain synthetic text and document structures only. They do not
include source exams, personal documents or original images.

- `handout.json`: question frame styles and two minimal questions.
- `english-exam.json`: empty stems linked to blanks, with and without options,
  and a question that owns its numbered blank.
- `math-exam.json`: twenty questions followed by an answer-image placeholder.
  The image is intentionally only a node reference; these tests exercise editing,
  not asset rendering or archive validation.

- `png.ts`: simple line drawings (ring, triangle, crossed box) rendered and
  encoded as PNG in code, for comparing question figures.

`CHALKLEE_TEST_FIXTURE_DIR` can point to a separate corpus containing files with
the JSON names above. Normal tests use the fixtures in this directory.

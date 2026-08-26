# Promptfoo Evals

The question set lives in `scripts/r1_project_questions.csv`. The prompt
variants live in `prompts/persona_*.txt`.

Generate promptfoo tests from the CSV:

```bash
cd src/llm
uv run python scripts/build_promptfoo_tests.py
```

Run the eval against the local LLM API:

```bash
cd src/llm
npx promptfoo@latest eval -c promptfooconfig.yaml
npx promptfoo@latest view
```

The local API must be running first:

```bash
uv run python -m uvicorn app:app --host 127.0.0.1 --port 3000
```

The generated rubric uses weighted assertions:

- `factuality` against the reference answer from the CSV.
- `llm-rubric` to reject contradictions.
- `llm-rubric` for directness, grounding, and uncertainty handling.
- Special high-weight checks for known risky topics such as SLAM language,
  Turnstile secrets, and Cloudflare tunnel credentials.

## Gold Context Eval

Use this mode to compare system prompts with fixed repository context, separate
from live RAG retrieval quality. The gold contexts live in
`scripts/r1_project_gold_contexts.csv`.

Generate the gold-context tests:

```bash
cd src/llm
python3 scripts/build_promptfoo_gold_tests.py
```

This writes three test files:

- `scripts/promptfoo_gold_tests.yaml`: all questions
- `scripts/promptfoo_gold_tests.dev.yaml`: first 40 questions for prompt/rubric tuning
- `scripts/promptfoo_gold_tests.holdout.yaml`: remaining questions for final evaluation

Run the full gold-context eval directly against Ollama:

```bash
cd src/llm
npx promptfoo@latest eval -c promptfooconfig.gold.yaml
```

Run only the 40-question development set:

```bash
cd src/llm
npx promptfoo@latest eval -c promptfooconfig.gold.dev.yaml
```

Run only the holdout set after prompt/rubric tuning is finished:

```bash
cd src/llm
npx promptfoo@latest eval -c promptfooconfig.gold.holdout.yaml
```

The outputs are written separately under `scripts/results/gold-context/`,
`scripts/results/gold-context-dev/`, and
`scripts/results/gold-context-holdout/`.

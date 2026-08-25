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

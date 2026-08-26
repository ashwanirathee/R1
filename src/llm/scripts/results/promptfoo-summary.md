# Promptfoo Summary

Eval ID: `eval-YVG-2026-08-25T03:48:43`

Run date: 2026-08-24 21:35 PT

Target API: `http://127.0.0.1:3000/v1/chat/completions`

Reported model: `qwen3:1.7b`

Matrix: 5 prompts x 49 questions = 245 test cases

Overall result: 51 passed, 194 failed, 0 errors

Duration: 46m 44s

Total grading tokens: 17,761,559

## Ranking

| Rank | Prompt | Passes | Avg score | Median score | Avg latency |
|---:|---|---:|---:|---:|---:|
| 1 | `prompts/persona_1.txt` | 14/49 | 0.4967 | 0.4522 | 21.4s |
| 2 | `prompts/persona_2.txt` | 11/49 | 0.4933 | 0.4565 | 21.2s |
| 3 | `prompts/persona_4.txt` | 12/49 | 0.4883 | 0.4457 | 21.7s |
| 4 | `prompts/persona_5.txt` | 10/49 | 0.4359 | 0.4391 | 25.1s |
| 5 | `prompts/persona_3.txt` | 4/49 | 0.3939 | 0.4065 | 25.6s |

Best prompt: `prompts/persona_1.txt`.

`persona_1` is the best current default because it has the highest average score and highest pass count. `persona_2` is close and had better source-grounding score, but it passed fewer test cases.

## Metric Notes

| Prompt | Factuality | No contradiction | Direct answer | Source grounding | Uncertainty |
|---|---:|---:|---:|---:|---:|
| `persona_1` | 0.367 | 0.829 | 0.612 | 0.120 | 0.026 |
| `persona_2` | 0.367 | 0.814 | 0.560 | 0.206 | 0.007 |
| `persona_3` | 0.184 | 0.746 | 0.470 | 0.116 | 0.033 |
| `persona_4` | 0.306 | 0.879 | 0.580 | 0.094 | 0.029 |
| `persona_5` | 0.286 | 0.708 | 0.581 | 0.196 | 0.027 |

The suite is currently harsh on source grounding and uncertainty. This is useful for exposing hallucinated file/topic names, but the next iteration should improve RAG retrieval/context formatting before overfitting the system prompt.

## Strongest Questions

| Avg score | Passes | Question |
|---:|---:|---|
| 0.878 | 5/5 | What programming language is used for SLAM in R1? |
| 0.769 | 5/5 | What real-world problem is R1 trying to solve or explore? |
| 0.765 | 4/5 | Does the project include a browser-facing web interface package? |
| 0.745 | 4/5 | Is ROS 2 used as the main runtime architecture for R1? |
| 0.696 | 3/5 | Does the repo include an experimental monocular SLAM package? |

## Weakest Questions

| Avg score | Passes | Question |
|---:|---:|---|
| 0.110 | 0/5 | How are human labels loaded, cleaned, and joined with model outputs? |
| 0.130 | 0/5 | Does the visual processor publish structured vision events? |
| 0.189 | 1/5 | Does the repo include Docker instructions for running the R1 environment? |
| 0.208 | 0/5 | How does the OpenCLIP classification experiment create embeddings and evaluate predictions? |
| 0.242 | 0/5 | What data flows from the camera node to the visual processor, brain node, action node, VLM node, and web interface? |

## Stored Outputs

- `scripts/results/promptfoo-results.json`
- `scripts/results/promptfoo-results.html`
- `scripts/results/promptfoo-summary.md`

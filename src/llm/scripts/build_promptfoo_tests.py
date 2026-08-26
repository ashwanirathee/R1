import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
QUESTIONS_CSV = ROOT / "scripts" / "r1_project_questions.csv"
TESTS_YAML = ROOT / "scripts" / "promptfoo_tests.yaml"


def yaml_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def rubric_assertion(value: str, weight: int, metric: str) -> list[str]:
    return [
        "  - type: llm-rubric",
        f"    value: {yaml_string(value)}",
        f"    weight: {weight}",
        f"    metric: {yaml_string(metric)}",
    ]


def factuality_assertion(reference: str, weight: int = 70) -> list[str]:
    return [
        "  - type: factuality",
        f"    value: {yaml_string(reference)}",
        f"    weight: {weight}",
        '    metric: "factuality"',
    ]


def contradiction_rubric(reference: str, weight: int = 80) -> list[str]:
    return rubric_assertion(
        (
            "The response must not contradict this reference answer. "
            f"Reference answer: {reference}"
        ),
        weight,
        "no_contradiction",
    )


def direct_answer_rubric(question_type: str, reference: str) -> list[str]:
    if question_type == "closed_ended":
        return rubric_assertion(
            (
                "The response should answer yes or no first when the question is closed-ended, "
                "then give a concise explanation consistent with this reference answer: "
                f"{reference}"
            ),
            30,
            "direct_answer",
        )

    return rubric_assertion(
        (
            "The response should directly answer the question first, then add only useful "
            "implementation detail. It should be concise and consistent with this reference answer: "
            f"{reference}"
        ),
        30,
        "direct_answer",
    )


def source_grounding_rubric() -> list[str]:
    return rubric_assertion(
        (
            "For repository facts, the response should ground claims in relevant R1 files, "
            "packages, nodes, routes, docs, or scripts when that context is available."
        ),
        25,
        "source_grounding",
    )


def uncertainty_rubric() -> list[str]:
    return rubric_assertion(
        (
            "The response should not invent details. If the repository context is insufficient "
            "or unrelated, it should say what is missing instead of guessing."
        ),
        25,
        "uncertainty",
    )


def special_case_assertions(question: str, reference: str) -> list[str]:
    lowered = question.lower()
    assertions: list[str] = []

    if "slam" in lowered and ("language" in lowered or "programming" in lowered):
        assertions.extend(
            rubric_assertion(
                "The response should say that the SLAM node/package is implemented in C++.",
                70,
                "slam_cpp",
            )
        )
        assertions.extend(
            rubric_assertion(
                "The response should not say or imply that SLAM is implemented in Python.",
                80,
                "slam_not_python",
            )
        )
        assertions.extend(
            rubric_assertion(
                (
                    "The response may clarify that the launch file is Python, but the SLAM "
                    "node itself is C++."
                ),
                20,
                "slam_launch_caveat",
            )
        )

    if "turnstile" in lowered:
        assertions.extend(
            rubric_assertion(
                (
                    "The response should distinguish between the public Turnstile site key "
                    "and server-side Turnstile/session secrets."
                ),
                40,
                "turnstile_secret_boundary",
            )
        )

    if "cloudflare" in lowered or "tunnel" in lowered:
        assertions.extend(
            rubric_assertion(
                (
                    "The response should not expose or ask for Cloudflare credential JSON, "
                    "tunnel secrets, or .env values."
                ),
                60,
                "cloudflare_secret_boundary",
            )
        )

    return assertions


def test_case(row: dict[str, str]) -> list[str]:
    question_id = row["id"].strip()
    question_type = row["type"].strip()
    question = row["question"].strip()
    answer = row["answer"].strip()

    lines = [
        f"- description: {yaml_string(f'{question_id}: {question}')}",
        "  vars:",
        f"    question: {yaml_string(question)}",
        "  metadata:",
        f"    id: {yaml_string(question_id)}",
        f"    type: {yaml_string(question_type)}",
        "  threshold: 0.75",
        "  assert:",
    ]

    assertions: list[str] = []
    assertions.extend(factuality_assertion(answer))
    assertions.extend(contradiction_rubric(answer))
    assertions.extend(direct_answer_rubric(question_type, answer))
    assertions.extend(source_grounding_rubric())
    assertions.extend(uncertainty_rubric())
    assertions.extend(special_case_assertions(question, answer))

    lines.extend(f"  {line}" for line in assertions)
    return lines


def main() -> None:
    with QUESTIONS_CSV.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    output = [
        "# Generated by scripts/build_promptfoo_tests.py from scripts/r1_project_questions.csv.",
        "# Edit the CSV or generator, then rerun the generator.",
        "",
    ]

    for row in rows:
        output.extend(test_case(row))

    TESTS_YAML.write_text("\n".join(output) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} promptfoo tests to {TESTS_YAML}")


if __name__ == "__main__":
    main()

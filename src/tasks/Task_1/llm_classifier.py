import base64
import json
import time
from pathlib import Path

import pandas as pd
import requests

from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
)


OLLAMA_URL = "http://localhost:11434/api/generate"

DATASET_DIR = Path("data/dataset/session_1")
HUMAN_LABELS_CSV = "data/project-1-at-2026-07-13-05-09-e8447dd6.csv"

OUTPUT_DIR = Path("data/ollama_vlm_results")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Use only the held-out test set
CUTOFF = pd.Timestamp("2026-07-10", tz="UTC")

MODELS = [
    "moondream",
    "llava",
    "qwen2.5vl:7b",
    # "gemma3:4b",
]

LABELING_POLICY = """
Labeling policy:
- true = a yellow ball is clearly visible and at least half of the ball is visible.
- false = no yellow ball is visible.
- false = a yellow object is visible but it is not clearly a ball.
- false = less than half of the ball is visible.
- false = the ball is too blurry, too small, occluded, or unclear.
- When uncertain, choose false.
""".strip()


PROMPT_TEMPLATE = """
You are evaluating whether an image contains a yellow ball.

{labeling_policy}

Answer only in valid JSON with this schema:
{{
  "yellow_ball_present": true or false,
  "confidence": number between 0 and 1,
  "reason": "short reason"
}}

Return JSON only. Do not include markdown or any text outside the JSON.
""".strip()


PROMPT = PROMPT_TEMPLATE.format(labeling_policy=LABELING_POLICY)


def encode_image_base64(image_path: Path) -> str:
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def load_human_labels(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)

    df["image"] = df["image"].apply(lambda x: str(x).split("/")[-1])
    df["created_at"] = pd.to_datetime(df["created_at"], utc=True)
    df["human_label"] = df["yellow_ball_present"].eq("yes")

    return df


def extract_json(text: str) -> dict:
    """
    Tries to parse model output as JSON.
    Handles cases where model adds extra text before/after JSON.
    """
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")

    if start != -1 and end != -1 and end > start:
        candidate = text[start : end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    return {
        "yellow_ball_present": None,
        "confidence": 0.0,
        "reason": f"Failed to parse JSON: {text[:200]}",
    }


def ask_ollama_vlm(model_name: str, image_path: Path) -> dict:
    image_b64 = encode_image_base64(image_path)

    payload = {
        "model": model_name,
        "prompt": PROMPT,
        "images": [image_b64],
        "stream": False,
        "options": {
            "temperature": 0.0,
            "num_predict": 128,
        },
    }

    start = time.perf_counter()

    response = requests.post(
        OLLAMA_URL,
        json=payload,
        timeout=120,
    )

    elapsed_ms = (time.perf_counter() - start) * 1000

    response.raise_for_status()
    data = response.json()

    raw_text = data.get("response", "")
    parsed = extract_json(raw_text)

    pred = parsed.get("yellow_ball_present", None)

    if isinstance(pred, str):
        pred = pred.strip().lower() in ["true", "yes", "1"]

    if not isinstance(pred, bool):
        pred = False

    confidence = parsed.get("confidence", 0.0)

    try:
        confidence = float(confidence)
    except Exception:
        confidence = 0.0

    return {
        "model": model_name,
        "image": image_path.name,
        "vlm_label": pred,
        "confidence": confidence,
        "reason": parsed.get("reason", ""),
        "raw_response": raw_text,
        "time_taken_ms": elapsed_ms,
    }


def evaluate_predictions(df: pd.DataFrame, model_name: str) -> dict:
    y_true = df["human_label"].astype(bool)
    y_pred = df["vlm_label"].astype(bool)

    acc = accuracy_score(y_true, y_pred)
    prec = precision_score(y_true, y_pred, zero_division=0)
    rec = recall_score(y_true, y_pred, zero_division=0)
    f1 = f1_score(y_true, y_pred, zero_division=0)

    tn, fp, fn, tp = confusion_matrix(
        y_true,
        y_pred,
        labels=[False, True],
    ).ravel()

    times = df["time_taken_ms"].dropna()

    mean_time_ms = times.mean()
    median_time_ms = times.median()
    min_time_ms = times.min()
    max_time_ms = times.max()
    std_time_ms = times.std()

    fps_mean = 1000.0 / mean_time_ms if mean_time_ms > 0 else 0.0
    fps_median = 1000.0 / median_time_ms if median_time_ms > 0 else 0.0

    return {
        "model": model_name,
        "num_images": len(df),
        "accuracy": acc,
        "precision": prec,
        "recall": rec,
        "f1": f1,
        "tn": int(tn),
        "fp": int(fp),
        "fn": int(fn),
        "tp": int(tp),
        "mean_time_ms": mean_time_ms,
        "median_time_ms": median_time_ms,
        "min_time_ms": min_time_ms,
        "max_time_ms": max_time_ms,
        "std_time_ms": std_time_ms,
        "fps_mean": fps_mean,
        "fps_median": fps_median,
    }

def run_model(model_name: str, eval_df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    rows = []

    for i, row in eval_df.iterrows():
        image_name = row["image"]
        image_path = DATASET_DIR / image_name

        if not image_path.exists():
            print(f"[{model_name}] Missing image: {image_path}")
            continue

        print(f"[{model_name}] {image_name}")

        try:
            pred = ask_ollama_vlm(model_name, image_path)
        except Exception as e:
            pred = {
                "model": model_name,
                "image": image_name,
                "vlm_label": False,
                "confidence": 0.0,
                "reason": f"ERROR: {e}",
                "raw_response": "",
                "time_taken_ms": None,
            }

        pred["human_label"] = bool(row["human_label"])
        pred["yellow_ball_present"] = row["yellow_ball_present"]
        rows.append(pred)

    result_df = pd.DataFrame(rows)

    result_csv = OUTPUT_DIR / f"{model_name.replace(':', '_')}_predictions.csv"
    result_df.to_csv(result_csv, index=False)
    print(f"Saved predictions: {result_csv}")

    valid_df = result_df.dropna(subset=["time_taken_ms"]).copy()
    metrics = evaluate_predictions(valid_df, model_name)

    return result_df, metrics


def main():
    human_df = load_human_labels(HUMAN_LABELS_CSV)

    # Final held-out test set
    test_df = human_df[human_df["created_at"] >= CUTOFF].copy()

    print("Test set size:", len(test_df))
    print(test_df["human_label"].value_counts())

    all_metrics = []

    for model_name in MODELS:
        print("\n" + "=" * 80)
        print("Evaluating:", model_name)
        print("=" * 80)

        _, metrics = run_model(model_name, test_df)
        all_metrics.append(metrics)

        print(metrics)

    metrics_df = pd.DataFrame(all_metrics)
    metrics_df = metrics_df.sort_values("f1", ascending=False)

    summary_csv = OUTPUT_DIR / "summary_metrics.csv"
    metrics_df.to_csv(summary_csv, index=False)

    print("\nFinal summary:")
    print(metrics_df)

    print(f"\nSaved summary: {summary_csv}")


if __name__ == "__main__":
    main()
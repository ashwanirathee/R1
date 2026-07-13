###
## We need to select clip threshold

import pandas as pd
import numpy as np
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
)


def load_human_labels(csv_path):
    df = pd.read_csv(csv_path)

    # Match the image filename with CLIP labels
    df["image"] = df["image"].apply(lambda x: x.split("/")[-1])

    # Convert created_at to datetime
    df["created_at"] = pd.to_datetime(df["created_at"], utc=True)

    # Keep only labels created after June 10, 2026
    # cutoff = pd.Timestamp("2026-07-10", tz="UTC")
    # df = df[df["created_at"] < cutoff]

    return df


def load_clip_labels(csv_path):
    df = pd.read_csv(csv_path)
    return df


human_labels_csv = "data/project-1-at-2026-07-13-05-09-e8447dd6.csv"
clip_labels_csv = "data/yellow_ball_clip_scores.csv"

human_labels_df = load_human_labels(human_labels_csv)

cutoff = pd.Timestamp("2026-07-10", tz="UTC")
human_labels_df_validation = human_labels_df[
    human_labels_df["created_at"] < cutoff
]
clip_labels_df = load_clip_labels(clip_labels_csv)

df = pd.merge(
    human_labels_df_validation,
    clip_labels_df,
    on="image",
    how="inner",
    validate="one_to_one",
)

df["human_label"] = df["yellow_ball_present"].apply(
    lambda x: True if x == "yes" else False
)

df["clip_label"] = df["yes_prob"] > df["no_prob"]

# Make sure labels are boolean
df["human_label"] = df["human_label"].astype(bool)
# df["margin"] = df["yes_prob"] - df["no_prob"]
df["margin"] = df["yes_score"] - df["no_score"]
thresholds = np.linspace(df["margin"].min(), df["margin"].max(), 500)

rows = []

human_label = df["human_label"]
for t in thresholds:
    pred = df["margin"] >= t

    acc = accuracy_score(human_label, pred)
    prec = precision_score(human_label, pred, zero_division=0)
    rec = recall_score(human_label, pred, zero_division=0)
    f1 = f1_score(human_label, pred, zero_division=0)

    tn, fp, fn, tp = confusion_matrix(human_label, pred).ravel()

    rows.append(
        {
            "threshold": t,
            "accuracy": acc,
            "precision": prec,
            "recall": rec,
            "f1": f1,
            "tn": tn,
            "fp": fp,
            "fn": fn,
            "tp": tp,
        }
    )

results = pd.DataFrame(rows)

best_f1 = results.sort_values("f1", ascending=False).iloc[0]
best_accuracy = results.sort_values("accuracy", ascending=False).iloc[0]

print("Best F1 threshold:")
print(best_f1)

print("\nBest accuracy threshold:")
print(best_accuracy)

# for threshold
best_f1_threshold = best_f1["threshold"]
human_labels_df_test = human_labels_df[human_labels_df["created_at"] >= cutoff]

merge_df = pd.merge(
    human_labels_df_test,
    clip_labels_df,
    on="image",
    how="inner",
    validate="one_to_one",
)
# create a new column 'human_label' based on the 'label' column from human_labels_df
# create a new column 'clip_label' based on the 'object_class' column from clip_labels_df
# both these are either True or False
merge_df["human_label"] = merge_df["yellow_ball_present"].apply(
    lambda x: True if x == "yes" else False
)

merge_df["margin"] = merge_df["yes_score"] - merge_df["no_score"]
merge_df["clip_label"] = (
    merge_df["margin"] >= best_f1_threshold
) 

confusion_table = pd.crosstab(
    merge_df["human_label"],
    merge_df["clip_label"],
    rownames=["Human Label"],
    colnames=["CLIP Label"],
    dropna=False,
)
print(confusion_table)

human_label = merge_df["human_label"]
pred = merge_df["clip_label"]
acc = accuracy_score(human_label, pred)
prec = precision_score(human_label, pred, zero_division=0)
rec = recall_score(human_label, pred, zero_division=0)
f1 = f1_score(human_label, pred, zero_division=0)

tn, fp, fn, tp = confusion_matrix(
    human_label,
    pred,
    labels=[False, True],
).ravel()
print(
    {
        "accuracy": acc,
        "precision": prec,
        "recall": rec,
        "f1": f1,
        "tn": tn,
        "fp": fp,
        "fn": fn,
        "tp": tp,
    }
)

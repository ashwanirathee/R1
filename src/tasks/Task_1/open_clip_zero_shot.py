import pandas as pd

# visualizae with fiftyone
# import fiftyone as fo
# import fiftyone.zoo as foz
from pathlib import Path
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
    cutoff = pd.Timestamp("2026-07-10", tz="UTC")
    df = df[df["created_at"] > cutoff]

    return df


def load_clip_labels(csv_path):
    df = pd.read_csv(csv_path)
    return df


def main():
    human_labels_csv = "data/project-1-at-2026-07-13-05-09-e8447dd6.csv"
    clip_labels_csv = "data/yellow_ball_clip_scores.csv"

    human_labels_df = load_human_labels(human_labels_csv)
    clip_labels_df = load_clip_labels(clip_labels_csv)

    merge_df = pd.merge(
        human_labels_df,
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
    # merge_df["clip_label"] = merge_df["yes_score"] > merge_df["no_score"]

    merge_df["clip_label"] = merge_df["yes_prob"] > merge_df["no_prob"]
    # merge_df["clip_label"] = True if merge_df["yes_prob"] > merge_df["no_prob"] else False

    # remove columns that are not needed for the final CSV
    # other than 'image', 'human_label', 'clip_label'
    # merge_df = merge_df[["image", "human_label", "clip_label"]]
    # merge_df = merge_df[merge_df["human_label"] != merge_df["clip_label"]]
    merge_df.to_csv("data/merged_labels.csv", index=False)

    # create confusion matrix
    # confusion_matrix = pd.crosstab(
    #     merge_df["human_label"],
    #     merge_df["clip_label"],
    #     rownames=["Human Label"],
    #     colnames=["CLIP Label"],
    # )
    print(confusion_matrix)

    human_label = merge_df["human_label"]
    pred = merge_df["clip_label"]
    acc = accuracy_score(human_label, pred)
    prec = precision_score(human_label, pred, zero_division=0)
    rec = recall_score(human_label, pred, zero_division=0)
    f1 = f1_score(human_label, pred, zero_division=0)

    tn, fp, fn, tp = confusion_matrix(human_label, pred).ravel()
    print({"accuracy": acc,
            "precision": prec,
            "recall": rec,
            "f1": f1,
            "tn": tn,
            "fp": fp,
            "fn": fn,
            "tp": tp})
    # dataset_path = "data/dataset/session_1"

    # label_map = merge_df.set_index("image").to_dict("index")

    # samples = []

    # for image_name, row in label_map.items():
    #     image_path = Path(dataset_path) / image_name

    #     if not image_path.exists():
    #         print("Missing image:", image_path)
    #         continue

    #     sample = fo.Sample(filepath=str(image_path))

    #     human_label = row["human_label"]
    #     clip_label = row["clip_label"]

    #     sample["human_label"] = bool(human_label)
    #     sample["clip_label"] = bool(clip_label)

    #     samples.append(sample)

    # if fo.dataset_exists("yellow_ball_human_clip_review"):
    #     fo.delete_dataset("yellow_ball_human_clip_review")

    # dataset = fo.Dataset("yellow_ball_human_clip_review")
    # dataset.add_samples(samples)

    # session = fo.launch_app(dataset)
    # session.wait()


if __name__ == "__main__":
    main()

import torch
from PIL import Image, UnidentifiedImageError
import open_clip
import os
import csv
import time
import numpy as np

device = "mps" if torch.backends.mps.is_available() else "cpu"
print("Using device:", device)

model_name = "ViT-B-32"
pretrained_dataset = "laion2b_s34b_b79k"
tokenizer_model_name = model_name

prompts = [
    "a photo of a yellow ball",
    "a photo with no ball",
]

model, _, preprocess = open_clip.create_model_and_transforms(
    model_name, pretrained=pretrained_dataset
)
model = model.to(device)
model.eval()

tokenizer = open_clip.get_tokenizer(tokenizer_model_name)
text = tokenizer(prompts).to(device)

with torch.no_grad():
    text_features = model.encode_text(text)
    text_features = text_features / text_features.norm(dim=-1, keepdim=True)

dataset_path = "./data/dataset/session_1/"

image_files = sorted(
    [
        f
        for f in os.listdir(dataset_path)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    ]
)

results = []
embeddings = []
image_names = []

for image_file in image_files:
    image_path = os.path.join(dataset_path, image_file)

    try:
        pil_image = Image.open(image_path).convert("RGB")
    except (UnidentifiedImageError, OSError) as e:
        print(f"Skipping bad image: {image_file} | {e}")
        continue

    start_time = time.perf_counter()

    image = preprocess(pil_image).unsqueeze(0).to(device)

    with torch.no_grad():
        image_features = model.encode_image(image)
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)

        scores = image_features @ text_features.T
        probs = (100.0 * scores).softmax(dim=-1)

    yes_score = scores[0, 0].item()
    no_score = scores[0, 1].item()
    yes_prob = probs[0, 0].item()
    no_prob = probs[0, 1].item()

    # Save normalized embedding as numpy
    embedding = image_features.squeeze(0).detach().cpu().numpy()

    end_time = time.perf_counter()
    time_taken_ms = (end_time - start_time) * 1000

    print(
        f"{image_file} | "
        f"yes_score={yes_score:.4f} "
        f"no_score={no_score:.4f} "
        f"yes_prob={yes_prob:.4f} "
        f"no_prob={no_prob:.4f} "
        f"time_taken={time_taken_ms:.2f} ms"
    )

    results.append(
        {
            "image": image_file,
            "yes_score": yes_score,
            "no_score": no_score,
            "yes_prob": yes_prob,
            "no_prob": no_prob,
            "margin": yes_score - no_score,
            "time_taken": time_taken_ms,
        }
    )

    embeddings.append(embedding)
    image_names.append(image_file)

# Save CLIP scores
out_csv = "data/yellow_ball_clip_scores.csv"

with open(out_csv, "w", newline="") as f:
    writer = csv.DictWriter(
        f,
        fieldnames=[
            "image",
            "yes_score",
            "no_score",
            "yes_prob",
            "no_prob",
            "margin",
            "time_taken",
        ],
    )
    writer.writeheader()
    writer.writerows(results)

print("Saved:", out_csv)

# Save embeddings
embeddings = np.stack(embeddings, axis=0)

np.save("data/yellow_ball_clip_embeddings.npy", embeddings)

with open("data/yellow_ball_clip_embedding_images.csv", "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["image"])
    writer.writeheader()
    for image_name in image_names:
        writer.writerow({"image": image_name})

print("Saved: data/yellow_ball_clip_embeddings.npy")
print("Saved: data/yellow_ball_clip_embedding_images.csv")
print("Embeddings shape:", embeddings.shape)

import pandas as pd
import numpy as np

from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix


def load_human_labels(csv_path):
    df = pd.read_csv(csv_path)
    df["image"] = df["image"].apply(lambda x: x.split("/")[-1])
    df["created_at"] = pd.to_datetime(df["created_at"], utc=True)
    df["human_label"] = df["yellow_ball_present"].eq("yes")
    return df


def evaluate(y_true, y_pred, name):
    acc = accuracy_score(y_true, y_pred)
    prec = precision_score(y_true, y_pred, zero_division=0)
    rec = recall_score(y_true, y_pred, zero_division=0)
    f1 = f1_score(y_true, y_pred, zero_division=0)

    tn, fp, fn, tp = confusion_matrix(
        y_true,
        y_pred,
        labels=[False, True],
    ).ravel()

    print(f"\n{name}")
    print({
        "accuracy": acc,
        "precision": prec,
        "recall": rec,
        "f1": f1,
        "tn": tn,
        "fp": fp,
        "fn": fn,
        "tp": tp,
    })


human_labels_csv = "data/project-1-at-2026-07-13-05-09-e8447dd6.csv"
embedding_path = "data/yellow_ball_clip_embeddings.npy"
embedding_images_csv = "data/yellow_ball_clip_embedding_images.csv"

cutoff = pd.Timestamp("2026-07-10", tz="UTC")

human_df = load_human_labels(human_labels_csv)

embedding_df = pd.read_csv(embedding_images_csv)
embeddings = np.load(embedding_path)

# Attach row index so we can retrieve embedding rows after merge
embedding_df["embedding_idx"] = np.arange(len(embedding_df))

df = pd.merge(
    human_df,
    embedding_df,
    on="image",
    how="inner",
    validate="one_to_one",
)

dev_df = df[df["created_at"] < cutoff].copy()
test_df = df[df["created_at"] >= cutoff].copy()

print("dev size:", len(dev_df))
print("test size:", len(test_df))

X_dev = embeddings[dev_df["embedding_idx"].values]
y_dev = dev_df["human_label"].values

X_test = embeddings[test_df["embedding_idx"].values]
y_test = test_df["human_label"].values

clf = LogisticRegression(
    max_iter=1000,
    class_weight="balanced",
)

clf.fit(X_dev, y_dev)

dev_pred = clf.predict(X_dev)
test_pred = clf.predict(X_test)

evaluate(y_dev, dev_pred, "Development set")
evaluate(y_test, test_pred, "Test set")
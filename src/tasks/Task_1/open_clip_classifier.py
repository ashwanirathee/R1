import torch
from PIL import Image, UnidentifiedImageError
import open_clip
import os
import csv
import time

device = "mps" if torch.backends.mps.is_available() else "cpu"
print("Using device:", device)

model_name = "ViT-B-32"
pretrained_dataset = "laion2b_s34b_b79k"
tokenizer_model_name = model_name
prompts = [
    "a image with a yellow ball",
    "a image with a no ball",
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

jpg_files = sorted(
    [
        f
        for f in os.listdir(dataset_path)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    ]
)

results = []

for jpg_file in jpg_files:
    image_path = os.path.join(dataset_path, jpg_file)

    try:
        pil_image = Image.open(image_path).convert("RGB")
    except (UnidentifiedImageError, OSError) as e:
        print(f"Skipping bad image: {jpg_file} | {e}")
        continue

    start_time = time.perf_counter()

    image = preprocess(pil_image).unsqueeze(0).to(device)

    with torch.no_grad():
        image_features = model.encode_image(image)
        image_features = image_features / image_features.norm(
            dim=-1, keepdim=True
        )

        scores = image_features @ text_features.T
        probs = (100.0 * scores).softmax(dim=-1)

    yes_score = scores[0, 0].item()
    no_score = scores[0, 1].item()
    yes_prob = probs[0, 0].item()
    no_prob = probs[0, 1].item()

    end_time = time.perf_counter()
    time_taken_ms = (end_time - start_time) * 1000

    print(
        f"{jpg_file} | "
        f"yes_score={yes_score:.4f} "
        f"no_score={no_score:.4f} "
        f"yes_prob={yes_prob:.4f} "
        f"no_prob={no_prob:.4f} "
        f"time_taken={time_taken_ms:.2f} ms"
    )

    results.append(
        {
            "image": jpg_file,
            "yes_score": yes_score,
            "no_score": no_score,
            "yes_prob": yes_prob,
            "no_prob": no_prob,
            "time_taken": time_taken_ms,  # Time taken in milliseconds
        }
    )

# Save results
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
            "time_taken",
        ],
    )
    writer.writeheader()
    writer.writerows(results)

print("Saved:", out_csv)

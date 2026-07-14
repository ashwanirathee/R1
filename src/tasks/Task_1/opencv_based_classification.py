import cv2
import numpy as np
import glob
from pathlib import Path
import pandas as pd

from pathlib import Path
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    classification_report
)
import time

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


# def load_clip_labels(csv_path):
#     df = pd.read_csv(csv_path)
#     return df

def detect_yellow_ball(frame):
    output = frame.copy()

    # Slight blur reduces small noisy regions
    blurred = cv2.GaussianBlur(frame, (5, 5), 0)

    hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)

    # Stricter yellow: increase S to remove gray/shadow wall noise
    lower_yellow = np.array([16, 90, 45])
    upper_yellow = np.array([36, 255, 230])

    mask = cv2.inRange(hsv, lower_yellow, upper_yellow)

    kernel = np.ones((7, 7), np.uint8)

    # Remove small noise
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    # Fill small holes inside ball
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(
        mask,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )

    best = None
    best_score = 0

    for c in contours:
        area = cv2.contourArea(c)

        # Increase this if shadow noise is still detected
        if area < 600:
            continue

        perimeter = cv2.arcLength(c, True)
        if perimeter == 0:
            continue

        circularity = 4 * np.pi * area / (perimeter * perimeter)

        x, y, w, h = cv2.boundingRect(c)
        aspect_ratio = w / float(h)

        (cx, cy), radius = cv2.minEnclosingCircle(c)

        if radius < 14:
            continue

        # Bounding box should be roughly square
        if aspect_ratio < 0.75 or aspect_ratio > 1.35:
            continue

        # Roundness check
        if circularity < 0.55:
            continue

        # Solidity: contour should fill its convex hull
        hull = cv2.convexHull(c)
        hull_area = cv2.contourArea(hull)
        if hull_area == 0:
            continue

        solidity = area / hull_area
        if solidity < 0.85:
            continue

        # Fill ratio: yellow contour should fill reasonable part of enclosing circle
        circle_area = np.pi * radius * radius
        fill_ratio = area / circle_area

        if fill_ratio < 0.45 or fill_ratio > 1.15:
            continue

        score = area * circularity * solidity * fill_ratio

        if score > best_score:
            best_score = score
            best = {
                "contour": c,
                "area": area,
                "circularity": circularity,
                "solidity": solidity,
                "fill_ratio": fill_ratio,
                "center": (int(cx), int(cy)),
                "radius": int(radius),
                "bbox": (x, y, w, h),
            }

    if best is None:
        return False, output, mask, None

    center = best["center"]
    radius = best["radius"]

    cv2.circle(output, center, radius, (0, 255, 0), 3)
    cv2.circle(output, center, 4, (0, 0, 255), -1)

    cv2.putText(
        output,
        f"area={best['area']:.0f} circ={best['circularity']:.2f} "
        f"sol={best['solidity']:.2f} fill={best['fill_ratio']:.2f}",
        (center[0] - 160, center[1] - radius - 10),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (0, 255, 0),
        2,
    )

    return True, output, mask, best

human_labels_csv = "data/project-1-at-2026-07-13-05-09-e8447dd6.csv"
human_labels_df = load_human_labels(human_labels_csv)
print(human_labels_df)
input()
folder = "data/dataset/session_1"
files = sorted(glob.glob(str(Path(folder) / "*.jpg")))

opencv_labels = []
opencv_found = []
time_taken = [] # in ms

for file in human_labels_df["image"]:
    file_path = str(Path(folder)/ file)
    img = cv2.imread(file_path)

    start_time = time.perf_counter()
    if img is None:
        print("Could not read:", file)
        opencv_found.append(None)
        opencv_labels.append(None)
        continue

    found, vis, mask, info = detect_yellow_ball(img)
    # found will be either true or false.
    print(file, "found:", found, "info:", info)

    opencv_found.append(found)
    opencv_labels.append("yes" if found else "no")
    end_time = time.perf_counter()
    time_taken_ms = (end_time - start_time) * 1000

    time_taken.append(time_taken_ms)
    # cv2.imshow("yellow ball detection", vis)
    # cv2.imshow("yellow mask", mask)

    # key = cv2.waitKey(0)

    # if key == ord("q"):
    #     break

# cv2.destroyAllWindows()

human_labels_df["opencv_found"] = opencv_found
human_labels_df["opencv_label"] = opencv_labels
human_labels_df["time_taken"] = time_taken

# Remove unreadable images, if any
eval_df = human_labels_df.dropna(subset=["opencv_label"]).copy()

# Convert labels to 0/1
eval_df["human_binary"] = eval_df["yellow_ball_present"].map({
    "yes": 1,
    "no": 0,
})

eval_df["opencv_binary"] = eval_df["opencv_label"].map({
    "yes": 1,
    "no": 0,
})

y_true = eval_df["human_binary"].tolist()
y_pred = eval_df["opencv_binary"].tolist()

accuracy = accuracy_score(y_true, y_pred)
precision = precision_score(y_true, y_pred, zero_division=0)
recall = recall_score(y_true, y_pred, zero_division=0)
f1 = f1_score(y_true, y_pred, zero_division=0)

cm = confusion_matrix(y_true, y_pred, labels=[0, 1])
tn, fp, fn, tp = cm.ravel()

metrics = {
    "num_images": len(eval_df),
    "accuracy": accuracy,
    "precision": precision,
    "recall": recall,
    "f1": f1,
    "tn": tn,
    "fp": fp,
    "fn": fn,
    "tp": tp,
}

print(metrics)

print(classification_report(
    y_true,
    y_pred,
    target_names=["no_ball", "yellow_ball"],
    zero_division=0,
))

print("Median time take in ms:", human_labels_df["time_taken"].median())
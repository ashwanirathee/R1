import cv2
import numpy as np
import glob
from pathlib import Path

from pathlib import Path
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
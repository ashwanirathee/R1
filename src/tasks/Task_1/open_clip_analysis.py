import pandas as pd
import matplotlib.pyplot as plt

# Basic runtime stats:
# Total images: 1845
# Total valid runtimes: 1845
# Runtimes shown <= 1000 ms: 1845
# Excluded runtimes above 1000 ms: 0

# Raw stats:
# Raw mean ms/image: 13.59987504715509
# Raw median ms/image: 13.377750000472588
# Raw p90 ms/image: 15.134900199700496
# Raw p95 ms/image: 15.934741799537735

# Shown-range stats:
# Shown mean ms/image: 13.59987504715509
# Shown median ms/image: 13.377750000472588
# Shown p90 ms/image: 15.134900199700496
# Shown p95 ms/image: 15.934741799537735

# Speed:
# FPS using shown mean: 73.53008733776466
# FPS using shown median: 74.75098577598428

# Estimated time for 100,000 images using median:
# Seconds: 1337.7750000472588
# Minutes: 22.296250000787648
# Hours: 0.3716041666797941

csv_path = "data/yellow_ball_clip_scores.csv"

df = pd.read_csv(csv_path)

TIME_COL = "time_taken"  # milliseconds
MAX_MS = 1000  # visual cutoff, change if needed
TARGET_IMAGES = 100_000

# Clean invalid values
times = df[TIME_COL].dropna()
times = times[times > 0]

# Focused range for visualization
times_in_range = times[times <= MAX_MS]
excluded_count = len(times) - len(times_in_range)

print(df.head())

print("\nBasic runtime stats:")
print("Total images:", len(df))
print("Total valid runtimes:", len(times))
print(f"Runtimes shown <= {MAX_MS} ms:", len(times_in_range))
print(f"Excluded runtimes above {MAX_MS} ms:", excluded_count)

print("\nRaw stats:")
print("Raw mean ms/image:", times.mean())
print("Raw median ms/image:", times.median())
print("Raw p90 ms/image:", times.quantile(0.90))
print("Raw p95 ms/image:", times.quantile(0.95))

print("\nShown-range stats:")
print("Shown mean ms/image:", times_in_range.mean())
print("Shown median ms/image:", times_in_range.median())
print("Shown p90 ms/image:", times_in_range.quantile(0.90))
print("Shown p95 ms/image:", times_in_range.quantile(0.95))

fps_mean = 1000 / times_in_range.mean()
fps_median = 1000 / times_in_range.median()

print("\nSpeed:")
print("FPS using shown mean:", fps_mean)
print("FPS using shown median:", fps_median)

# Extrapolate to 100k images
estimated_ms = times_in_range.median() * TARGET_IMAGES
estimated_seconds = estimated_ms / 1000

print(f"\nEstimated time for {TARGET_IMAGES:,} images using median:")
print("Seconds:", estimated_seconds)
print("Minutes:", estimated_seconds / 60)
print("Hours:", estimated_seconds / 3600)


# Plot 1: runtime over image order
plt.figure(figsize=(12, 6))
plt.plot(
    times.values,
    marker="o",
    linestyle="-",
    markersize=3,
    alpha=0.7,
    label="Runtime per image",
)
plt.axhline(
    y=times_in_range.mean(),
    color="r",
    linestyle="--",
    label=f"Mean = {times_in_range.mean():.2f} ms",
)
plt.axhline(
    y=times_in_range.median(),
    color="g",
    linestyle="--",
    label=f"Median = {times_in_range.median():.2f} ms",
)
plt.xlabel("Image index")
plt.ylabel("Runtime per image (ms)")
plt.title("OpenCLIP Runtime per Image")
plt.ylim(0, 35)
plt.legend()
plt.grid(True)
plt.tight_layout()
plt.show()


# Plot 2: histogram
plt.figure(figsize=(12, 6))
plt.hist(times_in_range, bins=40, edgecolor="black")
plt.xlim(10, 25)
plt.axvline(
    x=times_in_range.mean(),
    color="r",
    linestyle="--",
    label=f"Mean = {times_in_range.mean():.2f} ms",
)
plt.axvline(
    x=times_in_range.median(),
    color="g",
    linestyle="--",
    label=f"Median = {times_in_range.median():.2f} ms",
)
plt.xlabel("Runtime per image (ms)")
plt.ylabel("Frequency")
plt.title(
    f"Distribution of OpenCLIP Runtime "
    f"(0-35 ms, excluded {excluded_count} intervals above {MAX_MS} ms)"
)
plt.legend()
plt.grid(True)
plt.tight_layout()
plt.show()


# Plot 3: rolling median runtime
rolling_window = 10
rolling_median = times.rolling(rolling_window).median()

plt.figure(figsize=(12, 6))
plt.plot(
    times.values,
    marker="o",
    linestyle="-",
    markersize=3,
    alpha=0.4,
    label="Raw runtime",
)
plt.plot(
    rolling_median.values,
    linewidth=2,
    label=f"Rolling median, window={rolling_window}",
)
plt.xlabel("Image index")
plt.ylabel("Runtime per image (ms)")
plt.title("OpenCLIP Runtime Over Image Sequence")
plt.ylim(0, 35)
plt.legend()
plt.grid(True)
plt.tight_layout()
plt.show()

# 0.020 to 0.055
# Plot 4: score margin distribution
plt.figure(figsize=(12, 6))
df["margin"] = df["yes_score"] - df["no_score"]
plt.hist(df["margin"].dropna(), bins=100, edgecolor="black")
plt.axvline(
    x=df["margin"].median(),
    color="g",
    linestyle="--",
    label=f"Median margin = {df['margin'].median():.4f}",
)
plt.axvline(x=0, color="r", linestyle="--", label="margin = 0")
plt.xlabel("Yellow-ball margin score")
plt.ylabel("Frequency")
plt.title("Distribution of OpenCLIP Yellow-Ball Margin Scores")
plt.legend()
plt.grid(True)
plt.tight_layout()
plt.show()


# 0.020 to 0.055
# Plot 4: score margin distribution
plt.figure(figsize=(12, 6))
df["margin"] = df["yes_prob"] - df["no_prob"]
plt.hist(df["margin"].dropna(), bins=100, edgecolor="black")
plt.axvline(
    x=df["margin"].median(),
    color="g",
    linestyle="--",
    label=f"Median margin = {df['margin'].median():.4f}",
)
plt.axvline(x=0, color="r", linestyle="--", label="margin = 0")
plt.xlabel("Yellow-ball margin score")
plt.ylabel("Frequency")
plt.title("Distribution of OpenCLIP Yellow-Ball Margin 2 Scores")
plt.legend()
plt.grid(True)
plt.tight_layout()
plt.show()

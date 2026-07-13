import pandas as pd
import matplotlib.pyplot as plt

# Basic stats:
# Total images: 100
# Total intervals: 99
# Intervals shown: 98
# Excluded intervals above 20s: 1
# Raw mean: 4.341700626262626
# Raw median: 1.890624
# Shown mean: 2.9038068571428575
# Shown median: 1.8g80797
# Labels/min using shown median: 31.90136947262251

# Estimated time for 100k images using median:
# Hours: 52.24436111111111
# Days: 2.1768483796296296

csv_path = "./data/project-1-at-2026-07-09-23-06-9100703f.csv"

df = pd.read_csv(csv_path)

# Convert timestamp safely
df["created_at"] = pd.to_datetime(df["created_at"], utc=True, errors="coerce")

df = df.dropna(subset=["created_at"])

# Sort by timestamp
df = df.sort_values(by="created_at").reset_index(drop=True)

# Time difference between current and previous annotation
df["time_diff"] = df["created_at"].diff().dt.total_seconds()

# Clean basic invalid values
time_diffs = df["time_diff"].dropna()
time_diffs = time_diffs[time_diffs > 0]

# Visual cutoff
MAX_SECONDS = 20
time_diffs_in_range = time_diffs[time_diffs <= MAX_SECONDS]
excluded_count = len(time_diffs) - len(time_diffs_in_range)

print(df.head())

print("\nBasic stats:")
print("Total images:", len(df))
print("Total intervals:", len(time_diffs))
print("Intervals shown:", len(time_diffs_in_range))
print("Excluded intervals above 20s:", excluded_count)
print("Raw mean:", time_diffs.mean())
print("Raw median:", time_diffs.median())
print("Shown mean:", time_diffs_in_range.mean())
print("Shown median:", time_diffs_in_range.median())
print("Labels/min using shown median:", 60 / time_diffs_in_range.median())

target_images = 100_000
estimated_seconds = time_diffs_in_range.median() * target_images

print("\nEstimated time for 100k images using median:")
print("Hours:", estimated_seconds / 3600)
print("Days:", estimated_seconds / (3600 * 24))


# Plot 1: time difference over annotation order
plt.figure(figsize=(12, 6))
plt.plot(
    time_diffs.values,
    marker="o",
    linestyle="-",
    markersize=3,
    label="Time difference",
)
plt.axhline(
    y=time_diffs_in_range.mean(),
    color="r",
    linestyle="--",
    label="Mean shown range",
)
plt.axhline(
    y=time_diffs_in_range.median(),
    color="g",
    linestyle="--",
    label="Median shown range",
)
plt.xlabel("Annotation interval index")
plt.ylabel("Time difference (s)")
plt.title("Human Annotator Time Taken per Image")
plt.ylim(0, MAX_SECONDS)
plt.legend()
plt.grid(True)
plt.tight_layout()
plt.show()


# Plot 2: histogram
plt.figure(figsize=(12, 6))
plt.hist(time_diffs_in_range, bins=40, edgecolor="black")
plt.xlim(0, MAX_SECONDS)
plt.axvline(
    x=time_diffs_in_range.mean(),
    color="r",
    linestyle="--",
    label="Mean shown range",
)
plt.axvline(
    x=time_diffs_in_range.median(),
    color="g",
    linestyle="--",
    label="Median shown range",
)
plt.xlabel("Time difference (s)")
plt.ylabel("Frequency")
plt.title(
    f"Distribution of Human Annotation Time "
    f"(0-{MAX_SECONDS}s, excluded {excluded_count} intervals above {MAX_SECONDS}s)"
)
plt.legend()
plt.grid(True)
plt.tight_layout()
plt.show()


# Plot 3: rolling median to see speed trend
rolling_window = 10

rolling_median = time_diffs.rolling(rolling_window).median()

plt.figure(figsize=(12, 6))
plt.plot(
    time_diffs.values,
    marker="o",
    linestyle="-",
    markersize=3,
    alpha=0.4,
    label="Raw time difference",
)
plt.plot(
    rolling_median.values,
    linewidth=2,
    label=f"Rolling median, window={rolling_window}",
)
plt.xlabel("Annotation interval index")
plt.ylabel("Time difference (s)")
plt.title("Human Annotation Time Over Session")
plt.ylim(0, MAX_SECONDS)
plt.legend()
plt.grid(True)
plt.tight_layout()
plt.show()

### Task 1: Image Classification

There is a yellow ball sometimes in the scene. The task to classify the image as either "yes" or "no". Speed is of importance.

#### Dataset:
```
python setup_dataset.py
```

#### Env creation
```
python3 -m venv .venv_task1
source .venv_task1/bin/activate
pip install -r requirements.txt

```

#### Human Labelled data:
Human labelling is slow and busy work, but it can be used to validate the model. We have labelled 100 images for validation and 100 images for testing.

  - 9th July: only used for validation, 100 images labelled; took 10 min
  - 13th July: 100 images labelled, used for only testing

It's interesting problem to develop labelling guidelines on the go. I noticed that I choose to label to "no" if less than half of the ball is visible or I couldn't make out the ball.

#### Visualisation:
Label Studio is excellent for visualising the images and labelling them. It can also be used to export the labelled data in a format that can be used for training and validation. 

FiftyOne is also excellent for visualising the images.

#### Method:

We want to use the open clip model to classify the images. 
It can connect the image and text embeddings to classify the images
utilizing a zero shot threshold based approach.

### Results:

We use the balanced F1 score (2 * precision * recall / (precision + recall)) to evaluate the performance of the models on the testing data. The inference time is measured in frames per second (FPS) on same machine.

| Method      | Details  | F1 score | Inference Time (FPS) |
|-------------|------------|----------| ---------------|
| Open Clip   | yes_score > no_score or yes_prob > no_prob, zero shot classification | 0.920 | 13.57 ms |
| Open Clip   | Validation data based threshold | 0.938 | 14 ms |

### Future Work:
Add for comparison and evaluation of different methods for image classification:
1. Zero-shot OpenCLIP baseline
2. OpenClip validation data based threshold
2. Frozen CLIP/ViT/DINO embeddings + logistic regression
3. Pretrained ViT + train classification head
4. Pretrained ViT + unfreeze last block
5. Tiny ViT from scratch on yellow-ball data
6. Evaluate qwen3 and other models via ollama cloud and open router
7. Implement active learning to select the most useful images to label and retrain the model live on device with continual learning.
8. OpenCV based approach; parameter tuning is tricky part.

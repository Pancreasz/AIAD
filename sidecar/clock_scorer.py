import os
import logging
import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image

logger = logging.getLogger(__name__)

clock_model = None
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        [0.485, 0.456, 0.406],
        [0.229, 0.224, 0.225]
    )
])

def load_clock_model(model_path):
    global clock_model

    if clock_model is None:
        logger.info("Loading MoCA clock CNN model...")

        m = models.densenet121(weights=None)
        num_features = m.classifier.in_features
        m.classifier = nn.Linear(num_features, 4)

        m.load_state_dict(
            torch.load(model_path, map_location=device)
        )

        m.to(device)
        m.eval()

        clock_model = m

    return clock_model

def predict_clock_image(image_path, model_path):
    image = Image.open(image_path).convert("RGB")
    input_tensor = transform(image).unsqueeze(0).to(device)
    
    model = load_clock_model(model_path)

    with torch.no_grad():
        output = model(input_tensor)
        _, predicted = torch.max(output, 1)

    return predicted.item()

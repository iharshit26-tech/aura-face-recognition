FROM python:3.10-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

# Set working directory
WORKDIR /app

# Install system dependencies required for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy and install python requirements
COPY requirements.txt /app/
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Pre-cache DeepFace neural network weights during build
# This avoids downloading weights (~1GB total) at runtime, preventing API timeouts
RUN python3 -c "from deepface import DeepFace; \
from deepface.modules import modeling; \
DeepFace.build_model('VGG-Face'); \
modeling.build_model(task='facial_attribute', model_name='Age'); \
modeling.build_model(task='facial_attribute', model_name='Gender'); \
modeling.build_model(task='facial_attribute', model_name='Emotion')"

# Copy application source code
COPY backend /app/backend
COPY frontend /app/frontend

# Expose port
EXPOSE 8000

# Start server
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

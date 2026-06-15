import os
from PIL import Image

brain_dir = r"C:\Users\pedro\.gemini\antigravity\brain\7f8d96b2-5c80-4156-a707-9b12d85ca4af"

for f in os.listdir(brain_dir):
  if f.endswith('.png'):
    path = os.path.join(brain_dir, f)
    img = Image.open(path)
    print(f"{f}: size={img.size}, file_size={os.path.getsize(path)} bytes")

from PIL import Image
import os

image_path = r"C:\Users\pedro\.gemini\antigravity\brain\7f8d96b2-5c80-4156-a707-9b12d85ca4af\media__1780861194689.png"
output_path = r"C:\Users\pedro\Desktop\teg-modernizado\scratch\header_crop.png"

if os.path.exists(image_path):
    img = Image.open(image_path)
    width, height = img.size
    # Crop the top 1000 pixels
    cropped = img.crop((0, 0, width, min(1000, height)))
    cropped.save(output_path)
    print(f"Cropped image saved successfully to {output_path}. Size: {cropped.size}")
else:
    print(f"Error: Screenshot image not found at {image_path}")

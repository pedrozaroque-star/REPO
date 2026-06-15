from PIL import Image
import os

image_path = r"C:\Users\pedro\.gemini\antigravity\brain\7f8d96b2-5c80-4156-a707-9b12d85ca4af\media__1780861194689.png"
img = Image.open(image_path)
width, height = img.size

# Let's crop into 4 horizontal bands of 250px each to see the full UI in detail
for i in range(4):
    start_y = i * 250
    end_y = min((i + 1) * 250, height)
    cropped = img.crop((0, start_y, width, end_y))
    cropped.save(f"C:\\Users\\pedro\\Desktop\\teg-modernizado\\scratch\\crop_band_{i}.png")
    print(f"Saved band {i} to scratch")

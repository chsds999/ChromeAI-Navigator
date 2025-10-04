from PIL import Image
for size in [16, 32, 48, 128]:
    img = Image.new('RGBA', (size, size), (255, 255, 255, 0))  # Transparent image
    img.save(f'icon{size}.png')

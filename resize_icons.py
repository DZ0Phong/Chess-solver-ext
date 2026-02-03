import os
from PIL import Image


def resize_icon():
    source = "e:/Hoc_Code/Chess-solver-ext/src/assets/icon.png"
    if not os.path.exists(source):
        print(f"Error: {source} not found")
        return

    try:
        img = Image.open(source)
        sizes = [16, 48, 128]
        for size in sizes:
            resized = img.resize((size, size), Image.Resampling.LANCZOS)
            output = f"e:/Hoc_Code/Chess-solver-ext/src/assets/icon-{size}.png"
            resized.save(output)
            print(f"Created {output}")
    except Exception as e:
        print(f"Failed: {e}")


if __name__ == "__main__":
    resize_icon()
# 1 giac mo khong thanh

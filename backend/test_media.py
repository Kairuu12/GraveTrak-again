import urllib.request
import os

# Check if file exists on disk first
file_path = os.path.join('media', 'burial_applications', '2026', '05', '07', 'example_image.jpg')
print(f"Checking file on disk: {file_path}")
print(f"File exists: {os.path.exists(file_path)}")

# Test URL access
url = 'http://127.0.0.1:8000/media/burial_applications/2026/05/07/example_image.jpg'
print(f"Testing URL: {url}")

try:
    with urllib.request.urlopen(url) as response:
        print(f"Status: {response.status}")
        print(f"Content-Type: {response.headers.get('Content-Type')}")
        print("File is accessible via HTTP!")
except Exception as e:
    print(f"Error accessing file via HTTP: {e}")
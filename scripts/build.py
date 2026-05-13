"""
KnoPath 打包脚本 - 准备 Python Embedded 运行时

使用方法:
    python scripts/build.py

功能:
    1. 下载 Python Embedded 版本到 python-embed/
    2. 安装 pip
    3. 安装 app/requirements.txt 中的依赖
    4. 修改 python3x._pth 启用 site-packages

完成后运行:
    cd front && npm run build
"""

import os
import sys
import urllib.request
import zipfile
import subprocess
import shutil
import re

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYTHON_EMBED_DIR = os.path.join(ROOT_DIR, "python-embed")
APP_DIR = os.path.join(ROOT_DIR, "app")
REQUIREMENTS_FILE = os.path.join(APP_DIR, "requirements.txt")

PYTHON_VERSION = "3.12.9"
PYTHON_VERSION_SHORT = "3.12"
PYTHON_EMBED_URL = f"https://www.python.org/ftp/python/{PYTHON_VERSION}/python-{PYTHON_VERSION}-embed-amd64.zip"
GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"


def download_file(url: str, dest: str) -> None:
    print(f"  Downloading: {url}")
    urllib.request.urlretrieve(url, dest)


def step1_download_python_embed() -> None:
    if os.path.exists(os.path.join(PYTHON_EMBED_DIR, "python.exe")):
        print("[1/4] Python embed already exists, skipping download.")
        return

    print(f"[1/4] Downloading Python {PYTHON_VERSION} Embedded...")
    os.makedirs(PYTHON_EMBED_DIR, exist_ok=True)

    zip_path = os.path.join(PYTHON_EMBED_DIR, "python-embed.zip")
    download_file(PYTHON_EMBED_URL, zip_path)

    print("  Extracting...")
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(PYTHON_EMBED_DIR)
    os.remove(zip_path)
    print("  Done.")


def step2_enable_site_packages() -> None:
    print("[2/4] Enabling site-packages in python3x._pth...")

    pth_files = [f for f in os.listdir(PYTHON_EMBED_DIR) if f.endswith("._pth")]
    if not pth_files:
        print("  WARNING: No ._pth file found!")
        return

    pth_path = os.path.join(PYTHON_EMBED_DIR, pth_files[0])
    with open(pth_path, "r", encoding="utf-8") as f:
        content = f.read()

    if "Lib/site-packages" in content and not content.strip().startswith("#"):
        print("  Already configured, skipping.")
        return

    lines = content.split("\n")
    new_lines = []
    for line in lines:
        if line.strip().startswith("#") and "import site" in line:
            new_lines.append(line.lstrip("# "))
        else:
            new_lines.append(line)

    if not any("Lib/site-packages" in l for l in new_lines):
        new_lines.append("Lib/site-packages")

    with open(pth_path, "w", encoding="utf-8") as f:
        f.write("\n".join(new_lines))
    print("  Done.")


def step3_install_pip() -> None:
    pip_path = os.path.join(PYTHON_EMBED_DIR, "Scripts", "pip.exe")
    if os.path.exists(pip_path):
        print("[3/4] pip already installed, skipping.")
        return

    print("[3/4] Installing pip...")
    get_pip_path = os.path.join(PYTHON_EMBED_DIR, "get-pip.py")
    download_file(GET_PIP_URL, get_pip_path)

    python_exe = os.path.join(PYTHON_EMBED_DIR, "python.exe")
    subprocess.run(
        [python_exe, get_pip_path, "--no-warn-script-location"],
        check=True,
        cwd=PYTHON_EMBED_DIR,
    )
    os.remove(get_pip_path)
    print("  Done.")


def step4_install_requirements() -> None:
    print("[4/4] Installing app requirements...")
    python_exe = os.path.join(PYTHON_EMBED_DIR, "python.exe")
    pip_module = os.path.join(PYTHON_EMBED_DIR, "Scripts", "pip.exe")

    if not os.path.exists(pip_module):
        pip_module_cmd = [python_exe, "-m", "pip"]
    else:
        pip_module_cmd = [pip_module]

    subprocess.run(
        pip_module_cmd + [
            "install", "-r", REQUIREMENTS_FILE,
            "--no-warn-script-location",
        ],
        check=True,
    )
    print("  Done.")


def main() -> None:
    print("=" * 60)
    print("KnoPath Build - Preparing Python Embedded Runtime")
    print("=" * 60)
    print()

    if sys.platform != "win32":
        print("WARNING: This script is designed for Windows.")
        print("For macOS/Linux, use conda or system Python instead.")
        print()

    step1_download_python_embed()
    step2_enable_site_packages()
    step3_install_pip()
    step4_install_requirements()

    print()
    print("=" * 60)
    print("Python embed preparation complete!")
    print()
    print("Next steps:")
    print("  cd front")
    print("  npm run build")
    print()
    print("The installer will be in front/release/")
    print("=" * 60)


if __name__ == "__main__":
    main()

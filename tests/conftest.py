import sys
from pathlib import Path

# tools/ 의 두 스크립트를 모듈로 불러 시험한다.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

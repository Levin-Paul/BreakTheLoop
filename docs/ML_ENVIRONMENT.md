# Local Python Environment

## Python version
3.10.11 (used for creating the virtual environment)

## Create the environment
```powershell
python -m venv .venv
```

## Activate the environment (PowerShell)
```powershell
.\.venv\Scripts\Activate.ps1
```

## Install dependencies
```powershell
pip install torch transformers datasets scikit-learn numpy onnx onnxruntime
```

## Local ALBERT model path
`C:\Users\admin\Documents\BreakTheLoop\albert-base-v2`

## Verification command
```powershell
python infer_test.py
```

*The script prints the shape of the last hidden state, confirming local inference works.*

> The ALBERT weights are stored locally and are **not** committed to the repository. They are ignored via `.gitignore`.

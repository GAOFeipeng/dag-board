# DAGBoard

[English](#english) | [简体中文](#简体中文) | [日本語](#日本語)

![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-frontend-61DAFB?logo=react&logoColor=111)
![License](https://img.shields.io/badge/License-MIT-blue)

`DAGBoard` is a local ComfyUI-style workflow studio for causal discovery experiments. It provides a visual node canvas, typed ports, inline parameter editing, per-node previews, run logs, output inspection, and local artifact storage.

This public repository only ships official baseline adapters. It does not include private research algorithms.

## English

### Features

- ComfyUI-like DAG workflow canvas powered by React Flow.
- Typed node ports with run-time and pre-run validation.
- Inline controls for common node parameters.
- Inline graph and metric previews under nodes.
- Evaluation summary node for comparing multiple algorithm branches in one run.
- Right-click node menu for run-to-node, output viewing, rename, duplicate, delete, disable, and preview toggling.
- Structured run logs, output browser, artifact browser, and matrix preview.
- Local single-user storage using JSON, JSONL, and NPZ files.
- Multilingual UI: English, Simplified Chinese, and Japanese.

### Official Baselines

The algorithm node calls official library implementations:

- `PC` from gCastle
- `GES` from gCastle
- `Notears` from gCastle
- `NotearsLowRank` from gCastle
- `NotearsNonlinear` from gCastle
- `DAGMA` from the official `dagma` package

The project does not reimplement these algorithms.

### Architecture

```text
dag_studio/        Internal Python package name
  main.py          FastAPI app and REST/WebSocket routes
  execution.py     Workflow executor and node semantics
  baselines.py     Official baseline adapters
  simulation.py    Public synthetic DAG and SEM generators
  metrics.py       Standalone structure metrics
  storage.py       Local workflow/run/artifact storage
web/
  src/             Vite + React + TypeScript frontend
tests/
  test_dag_studio.py
```

### Quick Start

Install Python dependencies:

```powershell
uv sync --dev
```

Install frontend dependencies:

```powershell
cd web
npm install
```

Start the backend:

```powershell
uv run uvicorn dag_studio.main:app --host 127.0.0.1 --port 8000 --reload
```

Start the frontend:

```powershell
cd web
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

### Test

```powershell
uv run pytest
cd web
npm run test -- --run
npm run build
```

### GitHub Push

Create an empty GitHub repository first, then:

```powershell
git add .gitignore README.md pyproject.toml uv.lock dag_studio tests web
git commit -m "Initial DAGBoard public baseline app"
git remote add origin https://github.com/GAOFeipeng/dag-board.git
git branch -M main
git push -u origin main
```

## 简体中文

### 项目简介

`DAGBoard` 是一个本地运行的因果发现 DAG 工作台，界面风格接近 ComfyUI。它支持节点拖拽、端口连接、节点内参数调整、节点下方预览、运行日志、输出查看和本地 artifact 管理。

这个公开仓库只包含官方 baseline 的调用适配层，不包含任何私有研究算法。

### 功能

- 基于 React Flow 的节点式 DAG 工作流画布。
- 类型化输入/输出端口，连接时和运行前都会校验。
- 常用参数可直接在节点内部调整。
- 结构生成器、图展示、结构评价节点支持内联预览。
- 评估汇总节点可在同一次运行中对比多个算法分支。
- 节点右键菜单支持运行到此、查看输出、重命名、复制、删除、禁用、预览开关。
- 底部面板提供结构化日志、每步输出、artifact 列表和矩阵预览。
- 本地单用户存储，使用 JSON、JSONL 和 NPZ 文件。
- UI 支持英文、简体中文、日语切换。

### 官方 Baseline

算法节点只调用官方库函数：

- gCastle 的 `PC`
- gCastle 的 `GES`
- gCastle 的 `Notears`
- gCastle 的 `NotearsLowRank`
- gCastle 的 `NotearsNonlinear`
- 官方 `dagma` 包的 `DAGMA`

本项目不复现这些算法，只做工作流和可视化封装。

### 架构

```text
dag_studio/        内部 Python 包名
  main.py          FastAPI API 和 WebSocket
  execution.py     工作流执行器与节点语义
  baselines.py     官方 baseline 适配器
  simulation.py    公开版合成 DAG 和 SEM 数据生成
  metrics.py       独立结构评价指标
  storage.py       本地 workflow/run/artifact 存储
web/
  src/             Vite + React + TypeScript 前端
tests/
  test_dag_studio.py
```

### 快速开始

安装 Python 依赖：

```powershell
uv sync --dev
```

安装前端依赖：

```powershell
cd web
npm install
```

启动后端：

```powershell
uv run uvicorn dag_studio.main:app --host 127.0.0.1 --port 8000 --reload
```

启动前端：

```powershell
cd web
npm run dev
```

打开：

```text
http://127.0.0.1:5173
```

### 测试

```powershell
uv run pytest
cd web
npm run test -- --run
npm run build
```

### 推送到 GitHub

先在 GitHub 创建一个空仓库，然后执行：

```powershell
git add .gitignore README.md pyproject.toml uv.lock dag_studio tests web
git commit -m "Initial DAGBoard public baseline app"
git remote add origin https://github.com/GAOFeipeng/dag-board.git
git branch -M main
git push -u origin main
```

## 日本語

### 概要

`DAGBoard` は、因果発見実験のためのローカル DAG ワークフロースタジオです。ComfyUI に近いノード型インターフェースを提供し、ノード接続、型付きポート、ノード内パラメータ編集、インラインプレビュー、実行ログ、出力確認、ローカル artifact 管理に対応します。

この公開リポジトリには公式 baseline のアダプターのみが含まれます。非公開の研究アルゴリズムは含まれていません。

### 機能

- React Flow による DAG ワークフローキャンバス。
- 型付きポートと、接続時・実行前の検証。
- 主要パラメータをノード内で直接編集。
- 構造生成、グラフ表示、構造評価ノードのインラインプレビュー。
- 評価サマリーノードで、1 回の実行内の複数アルゴリズム分岐を比較。
- 右クリックメニューで、ここまで実行、出力表示、名前変更、複製、削除、無効化、プレビュー切替。
- 構造化ログ、ノード出力、artifact、行列プレビュー。
- JSON、JSONL、NPZ によるローカル単一ユーザー保存。
- 英語、簡体字中国語、日本語の UI 切替。

### 公式 Baseline

アルゴリズムノードは公式ライブラリ実装を呼び出します。

- gCastle の `PC`
- gCastle の `GES`
- gCastle の `Notears`
- gCastle の `NotearsLowRank`
- gCastle の `NotearsNonlinear`
- 公式 `dagma` パッケージの `DAGMA`

本プロジェクトはこれらのアルゴリズムを再実装しません。

### アーキテクチャ

```text
dag_studio/        内部 Python パッケージ名
  main.py          FastAPI API と WebSocket
  execution.py     ワークフロー実行器とノード仕様
  baselines.py     公式 baseline アダプター
  simulation.py    公開版の合成 DAG / SEM 生成
  metrics.py       独立した構造評価指標
  storage.py       ローカル workflow/run/artifact 保存
web/
  src/             Vite + React + TypeScript フロントエンド
tests/
  test_dag_studio.py
```

### クイックスタート

Python 依存関係をインストールします。

```powershell
uv sync --dev
```

フロントエンド依存関係をインストールします。

```powershell
cd web
npm install
```

バックエンドを起動します。

```powershell
uv run uvicorn dag_studio.main:app --host 127.0.0.1 --port 8000 --reload
```

フロントエンドを起動します。

```powershell
cd web
npm run dev
```

開く URL:

```text
http://127.0.0.1:5173
```

### テスト

```powershell
uv run pytest
cd web
npm run test -- --run
npm run build
```

### GitHub へ Push

まず GitHub で空のリポジトリを作成し、その後に実行します。

```powershell
git add .gitignore README.md pyproject.toml uv.lock dag_studio tests web
git commit -m "Initial DAGBoard public baseline app"
git remote add origin https://github.com/GAOFeipeng/dag-board.git
git branch -M main
git push -u origin main
```

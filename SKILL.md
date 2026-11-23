---
name: drawio-aws-arch
description: >-
  Terraform (.tf) が存在するプロジェクトを解析し、AWS のアーキテクチャ構成図を公式 AWS4 アイコン付き
  draw.io 図面（.drawio XML + XML埋め込み済み .drawio.png）として自動生成するスキル。
  デフォルトでは API Gateway / CloudFront / ALB / Lambda / Step Functions (SFN) / ECS / EKS / SQS / SNS / EventBridge / RDS (Aurora) / DynamoDB / S3 / ElastiCache など
  「実処理やデータ保持を伴う層」のみを抽出し、Security Group・IAM Role・VPC/Subnet/RouteTable・CloudWatch Logs などの補助リソースは省略する。
  ユーザーから明示的な指定があった場合のみ `--include security,network,iam,observability` で補助層も描画する。
  「TerraformからAWS構成図を作って」「このプロジェクトのAWSリソースをdraw.io図にして」「SecurityGroupも含めてAWS構成図を描いて」といった依頼のときに使用する。
---

# Terraform → AWS 構成図生成スキル (`drawio-aws-arch`)

Terraform (`.tf`) ファイル群を Pure Node.js スキャナで静的解析し、**実処理・データ保持を伴う AWS リソース**（API Gateway / Lambda / Step Functions / ECS / SQS / SNS / EventBridge / Aurora・RDS / DynamoDB / S3 等）とそれらの接続関係を抽出し、公式 AWS4 アイコンを用いた `.drawio` XML および `.drawio.png`（元XML埋め込み済み・draw.io再編集可能）を生成する。

---

## デフォルトの抽出方針とオプション層

- **デフォルトで描画する層（実処理・データ保持）**:
  - **Edge / API / Trigger**: `CloudFront`, `API Gateway`, `ALB`, `Cognito`, `EventBridge`
  - **Compute & Orchestration**: `Lambda`, `Step Functions (SFN)`, `ECS`, `EKS`, `EC2`, `AWS Batch`
  - **Messaging / Events**: `SQS`, `SNS`, `Kinesis`, `Firehose`
  - **Data & Storage**: `Aurora / RDS`, `DynamoDB`, `S3`, `ElastiCache`, `EFS`, `OpenSearch`
- **デフォルトでは省略する層（明示指定時のみ `--include` で追加）**:
  - `security`: `aws_security_group`, `aws_wafv2_web_acl`, `aws_kms_key`, `aws_secretsmanager_secret`
  - `network`: `aws_vpc`, `aws_subnet`, `aws_nat_gateway`, `aws_internet_gateway`, `aws_vpc_endpoint`
  - `iam`: `aws_iam_role`, `aws_iam_policy`
  - `observability`: `aws_cloudwatch_log_group`, `aws_cloudwatch_metric_alarm`
- ※ `aws_apigatewayv2_integration`・`aws_lambda_event_source_mapping`・`aws_s3_bucket_notification`・`aws_sns_topic_subscription`・`aws_cloudwatch_event_target` などの接続定義リソースは、箱としては描画せず**リソース間の矢印（エッジ）推論に自動利用**される。

---

## 実行手順

### 1. 抽出スコープの確認（任意・必要時）
- ユーザーが「Security Group や VPC も含めて」と指定している場合は `--include security` や `--include security,network` を付ける。
- 指定がない場合はデフォルト（実処理・データ層のみ、SecurityGroup・IAM等は省略）で実行する。

### 2. Terraform 解析 → `.drawio` + `.drawio.png` 一括生成（最短1コマンド）

```bash
SKILL=$HOME/.agents/skills/drawio-aws-arch

# デフォルト（API / Lambda / SFN / SQS / RDS / DynamoDB / S3 のみ描画、SG等は省略）
node "$SKILL/scripts/build-aws-arch.mjs" \
  --tf-dir /path/to/terraform \
  --output /path/to/aws-arch.drawio.png \
  --xml-out /path/to/aws-arch.drawio \
  --json-out /path/to/aws-arch.json

# Security Group や VPC も含めて描画する場合
node "$SKILL/scripts/build-aws-arch.mjs" \
  --tf-dir /path/to/terraform \
  --include security \
  --output /path/to/aws-arch-with-sg.drawio.png
```

### 3. JSON 仕様を手動/LLMで補完してから描画する（2ステップ方式）

Terraform の `module` 呼び出しやアプリコード側の環境変数など、静的スキャンだけでは拾いきれない接続がある場合は、`--json-out` で出力した JSON を編集して `--spec` で再描画できる。

```bash
node "$SKILL/scripts/scan-terraform.mjs" --tf-dir /path/to/terraform -o /path/to/aws-arch.json
# （必要に応じて aws-arch.json の nodes / edges / label を補完・整理）
node "$SKILL/scripts/build-aws-arch.mjs" --spec /path/to/aws-arch.json -o /path/to/aws-arch.drawio.png
```

### 4. 目視検証（必須）
- 生成された `.drawio.png` を `read_file` で読み込み、アイコン・ラベル・矢印の重なりや省略状況を確認してからユーザーへ報告する。

---

## リファレンス

- [references/resource-catalog.md](references/resource-catalog.md) — 対応 Terraform `aws_*` リソース種別・デフォルト/オプション分類・AWS4 アイコン一覧

# resource-catalog.md — 対応 Terraform リソース分類とアイコン一覧

## 1. デフォルトで描画されるリソース（実処理・データ保持層）

| レイヤー | Terraform リソース型 | `kind` | draw.io AWS4 ステンシル |
|---|---|---|---|
| **Edge / API** | `aws_cloudfront_distribution` | `cloudfront` | `mxgraph.aws4.cloudfront` |
| **Edge / API** | `aws_apigatewayv2_api`, `aws_api_gateway_rest_api` | `apigw` | `mxgraph.aws4.api_gateway` |
| **Edge / API** | `aws_lb`, `aws_alb` | `alb` | `mxgraph.aws4.application_load_balancer` |
| **Edge / API** | `aws_cognito_user_pool` | `cognito` | `mxgraph.aws4.cognito` |
| **Edge / API** | `aws_cloudwatch_event_rule`, `aws_scheduler_schedule` | `eventbridge` | `mxgraph.aws4.eventbridge` |
| **Compute** | `aws_lambda_function` | `lambda` | `mxgraph.aws4.lambda` |
| **Compute** | `aws_sfn_state_machine` | `sfn` | `mxgraph.aws4.step_functions` |
| **Compute** | `aws_ecs_service`, `aws_batch_job_definition` | `ecs` | `mxgraph.aws4.ecs` |
| **Compute** | `aws_eks_cluster` | `eks` | `mxgraph.aws4.eks` |
| **Compute** | `aws_instance` | `ec2` | `mxgraph.aws4.ec2` |
| **Messaging** | `aws_sqs_queue` | `sqs` | `mxgraph.aws4.sqs` |
| **Messaging** | `aws_sns_topic` | `sns` | `mxgraph.aws4.sns` |
| **Messaging** | `aws_kinesis_stream` | `kinesis` | `mxgraph.aws4.kinesis` |
| **Messaging** | `aws_kinesis_firehose_delivery_stream` | `firehose` | `mxgraph.aws4.kinesis_data_firehose` |
| **Storage** | `aws_rds_cluster` | `aurora` | `mxgraph.aws4.aurora` |
| **Storage** | `aws_db_instance` | `rds` | `mxgraph.aws4.rds` |
| **Storage** | `aws_dynamodb_table` | `dynamodb` | `mxgraph.aws4.dynamodb` |
| **Storage** | `aws_s3_bucket` | `s3` | `mxgraph.aws4.s3` |
| **Storage** | `aws_elasticache_cluster`, `aws_elasticache_replication_group` | `elasticache` | `mxgraph.aws4.elasticache` |
| **Storage** | `aws_efs_file_system` | `efs` | `mxgraph.aws4.efs_standard` |
| **Storage** | `aws_opensearch_domain` | `opensearch` | `mxgraph.aws4.opensearch_service_data_node` |

## 2. デフォルト省略（`--include <category>` 指定時のみ描画）

| カテゴリ (`--include`) | Terraform リソース型 |
|---|---|
| `security` | `aws_security_group`, `aws_wafv2_web_acl`, `aws_kms_key`, `aws_secretsmanager_secret` |
| `network` | `aws_vpc`, `aws_subnet`, `aws_nat_gateway`, `aws_internet_gateway`, `aws_vpc_endpoint` |
| `iam` | `aws_iam_role`, `aws_iam_policy` |
| `observability` | `aws_cloudwatch_log_group`, `aws_cloudwatch_metric_alarm` |

## 3. 接続推論（エッジ自動生成）に利用する Glue リソース

以下は箱としては描画せず、リソース間の接続線（矢印）を自動生成するために解析します：
- `aws_apigatewayv2_integration`, `aws_api_gateway_integration` → `API Gateway` → `Lambda` / `SFN`
- `aws_lambda_event_source_mapping` → `SQS` / `DynamoDB` / `Kinesis` → `Lambda`
- `aws_s3_bucket_notification` → `S3` → `Lambda` / `SQS` / `SNS`
- `aws_sns_topic_subscription` → `SNS` → `SQS` / `Lambda`
- `aws_cloudwatch_event_target` → `EventBridge` → `Lambda` / `SFN` / `SQS`
- `aws_lb_listener`, `aws_lb_target_group` → `ALB` → `ECS` / `EC2` / `Lambda`
- さらに各リソースの `environment` や `definition`（Step Functions JSON 等）内の `aws_<type>.<name>` 参照からデータアクセス・起動関係を自動抽出します。

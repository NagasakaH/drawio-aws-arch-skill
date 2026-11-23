#!/usr/bin/env node
/**
 * scan-terraform.mjs
 * Pure Node.js (.mjs) Terraform (.tf) scanner for AWS Architecture Diagram generation.
 *
 * By default, extracts active compute, API, orchestration, messaging, and data/storage
 * resources (API Gateway, CloudFront, ALB, Lambda, Step Functions, ECS, EKS, EC2,
 * SQS, SNS, EventBridge, Kinesis, RDS/Aurora, DynamoDB, S3, ElastiCache, EFS, OpenSearch)
 * and automatically infers connections from integrations, event source mappings,
 * S3/SNS/EventBridge targets, Step Functions definitions, and HCL attribute references.
 *
 * Security Groups, IAM roles/policies, VPC plumbing (route tables, NAT, subnets),
 * and CloudWatch log groups/alarms are OMITTED by default unless explicitly requested
 * via `--include security,network,iam,observability`.
 */
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

/**
 * Resource classification catalog:
 * - layer: "edge" | "compute" | "messaging" | "storage" | "security" | "network" | "iam" | "observability"
 * - defaultIncluded: true for real processing / data holding layers, false for SG / IAM / network plumbing
 */
export const AWS_RESOURCE_CATALOG = {
  // === Edge / Entry (default included) ===
  aws_cloudfront_distribution: { layer: "edge", kind: "cloudfront", label: "CloudFront", defaultIncluded: true },
  aws_apigatewayv2_api: { layer: "edge", kind: "apigw", label: "API Gateway (HTTP/WS)", defaultIncluded: true },
  aws_api_gateway_rest_api: { layer: "edge", kind: "apigw", label: "API Gateway (REST)", defaultIncluded: true },
  aws_lb: { layer: "edge", kind: "alb", label: "ALB / NLB", defaultIncluded: true },
  aws_alb: { layer: "edge", kind: "alb", label: "Application Load Balancer", defaultIncluded: true },
  aws_appsync_graphql_api: { layer: "edge", kind: "apigw", label: "AppSync GraphQL", defaultIncluded: true },
  aws_cognito_user_pool: { layer: "edge", kind: "cognito", label: "Cognito User Pool", defaultIncluded: true },
  aws_cloudwatch_event_rule: { layer: "edge", kind: "eventbridge", label: "EventBridge Rule", defaultIncluded: true },
  aws_scheduler_schedule: { layer: "edge", kind: "eventbridge", label: "EventBridge Scheduler", defaultIncluded: true },

  // === Compute & Orchestration (default included) ===
  aws_lambda_function: { layer: "compute", kind: "lambda", label: "AWS Lambda", defaultIncluded: true },
  aws_sfn_state_machine: { layer: "compute", kind: "sfn", label: "Step Functions", defaultIncluded: true },
  aws_ecs_service: { layer: "compute", kind: "ecs", label: "ECS Service", defaultIncluded: true },
  aws_ecs_cluster: { layer: "compute", kind: "ecs", label: "ECS Cluster", defaultIncluded: false, category: "cluster" },
  aws_eks_cluster: { layer: "compute", kind: "eks", label: "EKS Cluster", defaultIncluded: true },
  aws_instance: { layer: "compute", kind: "ec2", label: "EC2 Instance", defaultIncluded: true },
  aws_batch_job_definition: { layer: "compute", kind: "ecs", label: "AWS Batch Job", defaultIncluded: true },

  // === Messaging & Streaming (default included) ===
  aws_sqs_queue: { layer: "messaging", kind: "sqs", label: "Amazon SQS", defaultIncluded: true },
  aws_sns_topic: { layer: "messaging", kind: "sns", label: "Amazon SNS", defaultIncluded: true },
  aws_kinesis_stream: { layer: "messaging", kind: "kinesis", label: "Kinesis Data Stream", defaultIncluded: true },
  aws_kinesis_firehose_delivery_stream: { layer: "messaging", kind: "firehose", label: "Kinesis Firehose", defaultIncluded: true },

  // === Data & Storage (default included) ===
  aws_rds_cluster: { layer: "storage", kind: "aurora", label: "Amazon Aurora", defaultIncluded: true },
  aws_db_instance: { layer: "storage", kind: "rds", label: "Amazon RDS", defaultIncluded: true },
  aws_dynamodb_table: { layer: "storage", kind: "dynamodb", label: "Amazon DynamoDB", defaultIncluded: true },
  aws_s3_bucket: { layer: "storage", kind: "s3", label: "Amazon S3", defaultIncluded: true },
  aws_elasticache_cluster: { layer: "storage", kind: "elasticache", label: "ElastiCache", defaultIncluded: true },
  aws_elasticache_replication_group: { layer: "storage", kind: "elasticache", label: "ElastiCache Redis", defaultIncluded: true },
  aws_efs_file_system: { layer: "storage", kind: "efs", label: "Amazon EFS", defaultIncluded: true },
  aws_opensearch_domain: { layer: "storage", kind: "opensearch", label: "OpenSearch", defaultIncluded: true },
  aws_elasticsearch_domain: { layer: "storage", kind: "opensearch", label: "OpenSearch", defaultIncluded: true },

  // === Security (OMITTED by default; include with --include security) ===
  aws_security_group: { layer: "security", kind: "sg", label: "Security Group", defaultIncluded: false, category: "security" },
  aws_wafv2_web_acl: { layer: "security", kind: "waf", label: "AWS WAF", defaultIncluded: false, category: "security" },
  aws_kms_key: { layer: "security", kind: "kms", label: "AWS KMS", defaultIncluded: false, category: "security" },
  aws_secretsmanager_secret: { layer: "security", kind: "secrets", label: "Secrets Manager", defaultIncluded: false, category: "security" },

  // === Network Plumbing (OMITTED by default; include with --include network) ===
  aws_vpc: { layer: "network", kind: "vpc", label: "Amazon VPC", defaultIncluded: false, category: "network" },
  aws_subnet: { layer: "network", kind: "subnet", label: "Subnet", defaultIncluded: false, category: "network" },
  aws_nat_gateway: { layer: "network", kind: "nat", label: "NAT Gateway", defaultIncluded: false, category: "network" },
  aws_internet_gateway: { layer: "network", kind: "igw", label: "Internet Gateway", defaultIncluded: false, category: "network" },
  aws_vpc_endpoint: { layer: "network", kind: "vpce", label: "VPC Endpoint", defaultIncluded: false, category: "network" },

  // === IAM (OMITTED by default; include with --include iam) ===
  aws_iam_role: { layer: "iam", kind: "iam", label: "IAM Role", defaultIncluded: false, category: "iam" },
  aws_iam_policy: { layer: "iam", kind: "iam", label: "IAM Policy", defaultIncluded: false, category: "iam" },

  // === Observability (OMITTED by default; include with --include observability) ===
  aws_cloudwatch_log_group: { layer: "observability", kind: "cloudwatch", label: "CloudWatch Logs", defaultIncluded: false, category: "observability" },
  aws_cloudwatch_metric_alarm: { layer: "observability", kind: "cloudwatch", label: "CloudWatch Alarm", defaultIncluded: false, category: "observability" },
};

const GLUE_RESOURCE_TYPES = new Set([
  "aws_api_gateway_integration",
  "aws_apigatewayv2_integration",
  "aws_apigatewayv2_route",
  "aws_lambda_event_source_mapping",
  "aws_s3_bucket_notification",
  "aws_sns_topic_subscription",
  "aws_cloudwatch_event_target",
  "aws_lb_target_group",
  "aws_lb_listener",
  "aws_lb_listener_rule",
]);

/**
 * Recursively collects all `.tf` files under `rootDir`, skipping `.terraform`, `node_modules`, `.git`.
 */
async function findTerraformFiles(rootDir) {
  const results = [];
  const skipDirs = new Set([".terraform", "node_modules", ".git", "dist", "out"]);

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (!skipDirs.has(ent.name)) {
          await walk(path.join(dir, ent.name));
        }
      } else if (ent.isFile() && ent.name.endsWith(".tf")) {
        results.push(path.join(dir, ent.name));
      }
    }
  }

  await walk(rootDir);
  results.sort();
  return results;
}

/**
 * Strips HCL comments (#..., //..., /* ... *\/) while preserving quoted strings.
 */
function stripHclComments(src) {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < src.length) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
    } else if (ch === "#") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/**
 * Extracts top-level `resource "<type>" "<name>" { ... }` blocks from a `.tf` file.
 */
function parseTerraformBlocks(content, filePath) {
  const clean = stripHclComments(content);
  const blocks = [];
  const headerRe = /\b(resource|data|module)\s+"([^"]+)"(?:\s+"([^"]+)")?\s*\{/g;

  let m;
  while ((m = headerRe.exec(clean)) !== null) {
    const blockKind = m[1];
    const typeOrName = m[2];
    const resName = m[3] || "";
    let depth = 1;
    let pos = headerRe.lastIndex;
    let inStr = false;

    while (pos < clean.length && depth > 0) {
      const ch = clean[pos];
      if (inStr) {
        if (ch === "\\" && pos + 1 < clean.length) {
          pos += 2;
          continue;
        }
        if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      pos++;
    }

    const body = clean.slice(headerRe.lastIndex, pos - 1);
    blocks.push({
      blockKind,
      type: blockKind === "module" ? "module" : typeOrName,
      name: blockKind === "module" ? typeOrName : resName,
      body,
      filePath,
    });
    headerRe.lastIndex = pos;
  }

  return blocks;
}

function extractStringAttr(body, keys) {
  for (const k of keys) {
    const re = new RegExp(`\\b${k}\\s*=\\s*"([^"]+)"`);
    const m = body.match(re);
    if (m) return m[1];
  }
  return null;
}

function extractResourceReferences(body) {
  const refs = new Set();
  const re = /\b(aws_[a-z0-9_]+)\.([a-zA-Z0-9_-]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    refs.add(`${m[1]}.${m[2]}`);
  }
  return [...refs];
}

function buildResourceSubtitle(type, name, body) {
  const details = [];
  if (type === "aws_lambda_function") {
    const rt = extractStringAttr(body, ["runtime"]);
    const fn = extractStringAttr(body, ["function_name"]);
    if (fn && fn !== name) details.push(fn);
    if (rt) details.push(rt);
  } else if (type === "aws_rds_cluster" || type === "aws_db_instance") {
    const eng = extractStringAttr(body, ["engine"]);
    const db = extractStringAttr(body, ["database_name", "db_name", "identifier", "cluster_identifier"]);
    if (eng) details.push(eng);
    if (db) details.push(db);
  } else if (type === "aws_dynamodb_table") {
    const hk = extractStringAttr(body, ["hash_key"]);
    const rk = extractStringAttr(body, ["range_key"]);
    if (hk) details.push(rk ? `PK: ${hk} / SK: ${rk}` : `PK: ${hk}`);
  } else if (type === "aws_s3_bucket") {
    const bk = extractStringAttr(body, ["bucket", "bucket_prefix"]);
    if (bk) details.push(bk);
  } else if (type === "aws_apigatewayv2_api" || type === "aws_api_gateway_rest_api") {
    const proto = extractStringAttr(body, ["protocol_type"]);
    const apiName = extractStringAttr(body, ["name"]);
    if (apiName && apiName !== name) details.push(apiName);
    if (proto) details.push(proto);
  } else if (type === "aws_sfn_state_machine") {
    const sfnType = extractStringAttr(body, ["type"]);
    const sfnName = extractStringAttr(body, ["name"]);
    if (sfnName && sfnName !== name) details.push(sfnName);
    if (sfnType) details.push(sfnType);
  } else if (type === "aws_sqs_queue" || type === "aws_sns_topic") {
    const qName = extractStringAttr(body, ["name"]);
    if (qName && qName !== name) details.push(qName);
    if (/\bfifo_queue\s*=\s*true\b/.test(body)) details.push("FIFO");
  } else if (type === "aws_security_group") {
    const desc = extractStringAttr(body, ["description", "name"]);
    if (desc) details.push(desc);
  } else if (type === "aws_vpc") {
    const cidr = extractStringAttr(body, ["cidr_block"]);
    if (cidr) details.push(cidr);
  } else if (type === "aws_elasticache_cluster" || type === "aws_elasticache_replication_group") {
    const eng = extractStringAttr(body, ["engine"]);
    if (eng) details.push(eng);
  } else if (type === "aws_ecs_service") {
    const lt = extractStringAttr(body, ["launch_type"]);
    if (lt) details.push(lt);
  } else if (type === "aws_cloudwatch_event_rule" || type === "aws_scheduler_schedule") {
    const sched = extractStringAttr(body, ["schedule_expression"]);
    if (sched) details.push(sched);
  }
  return details.join(" / ");
}

function makeDisplayName(type, tfName, body) {
  const explicitName = extractStringAttr(body, [
    "function_name",
    "cluster_identifier",
    "identifier",
    "bucket",
    "name",
  ]);
  // Avoid noisy Terraform interpolation strings like "${var.env}-orders"
  if (explicitName && !explicitName.includes("${") && explicitName.length <= 34) {
    return explicitName;
  }
  return tfName;
}

/**
 * Scans a directory of `.tf` files and produces an architecture specification object.
 */
export async function scanTerraformDirectory(
  tfDir,
  {
    includeCategories = [],
    title = null,
    subtitle = null,
  } = {}
) {
  const includeSet = new Set(
    includeCategories.map((c) => String(c).trim().toLowerCase()).filter(Boolean)
  );
  const includeAll = includeSet.has("all");

  const tfFiles = await findTerraformFiles(tfDir);
  if (tfFiles.length === 0) {
    throw new Error(`No .tf files found under: ${tfDir}`);
  }

  const allResources = new Map(); // key = "aws_type.name"
  const glueBlocks = [];
  const omittedSummary = {};

  for (const fp of tfFiles) {
    const content = await fs.readFile(fp, "utf8");
    const blocks = parseTerraformBlocks(content, fp);
    for (const blk of blocks) {
      if (blk.blockKind !== "resource") continue;
      const addr = `${blk.type}.${blk.name}`;

      if (GLUE_RESOURCE_TYPES.has(blk.type)) {
        glueBlocks.push({ ...blk, addr, refs: extractResourceReferences(blk.body) });
        continue;
      }

      const meta = AWS_RESOURCE_CATALOG[blk.type];
      if (!meta) {
        omittedSummary[blk.type] = (omittedSummary[blk.type] || 0) + 1;
        continue;
      }

      const isIncluded =
        meta.defaultIncluded ||
        includeAll ||
        (meta.category && includeSet.has(meta.category)) ||
        includeSet.has(blk.type) ||
        includeSet.has(meta.kind);

      if (!isIncluded) {
        omittedSummary[blk.type] = (omittedSummary[blk.type] || 0) + 1;
        continue;
      }

      allResources.set(addr, {
        id: addr.replace(/[^a-zA-Z0-9_]/g, "_"),
        tfAddress: addr,
        tfType: blk.type,
        tfName: blk.name,
        layer: meta.layer,
        kind: meta.kind,
        label: makeDisplayName(blk.type, blk.name, blk.body),
        serviceLabel: meta.label,
        subtitle: buildResourceSubtitle(blk.type, blk.name, blk.body),
        file: path.relative(tfDir, fp),
        refs: extractResourceReferences(blk.body),
        body: blk.body,
      });
    }
  }

  // Infer edges between included resources
  const edgeMap = new Map();
  const addEdge = (fromAddr, toAddr, label, type = "flow") => {
    if (!fromAddr || !toAddr || fromAddr === toAddr) return;
    if (!allResources.has(fromAddr) || !allResources.has(toAddr)) return;
    const fromRes = allResources.get(fromAddr);
    const toRes = allResources.get(toAddr);
    const key = `${fromRes.id}->${toRes.id}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        from: fromRes.id,
        to: toRes.id,
        label: label || "",
        type,
      });
    } else if (label && !edgeMap.get(key).label) {
      edgeMap.get(key).label = label;
    }
  };

  // 1. Direct HCL references inside resource bodies (e.g. Lambda env vars referencing RDS/DynamoDB/S3/SQS, SFN referencing Lambda/DynamoDB, CloudFront referencing S3/ALB/APIGW)
  for (const res of allResources.values()) {
    for (const refAddr of res.refs) {
      if (!allResources.has(refAddr)) continue;
      const target = allResources.get(refAddr);

      if (res.layer === "edge" && (target.layer === "compute" || target.layer === "storage")) {
        addEdge(res.tfAddress, refAddr, res.kind === "cloudfront" ? "Origin" : "Route", "flow");
      } else if (res.layer === "compute" && target.layer === "storage") {
        const opLabel =
          target.kind === "s3"
            ? "S3 R/W"
            : target.kind === "dynamodb"
              ? "Query/Put"
              : target.kind === "elasticache"
                ? "Cache"
                : "SQL";
        addEdge(res.tfAddress, refAddr, opLabel, "data");
      } else if (res.layer === "compute" && target.layer === "messaging") {
        addEdge(res.tfAddress, refAddr, target.kind === "sqs" ? "SendMessage" : "Publish", "async");
      } else if (res.layer === "compute" && target.layer === "compute") {
        addEdge(res.tfAddress, refAddr, res.kind === "sfn" ? "Task Invoke" : "Invoke", "flow");
      } else if (target.layer === "security") {
        addEdge(res.tfAddress, refAddr, "attached", "security");
      } else if (target.layer === "network") {
        addEdge(res.tfAddress, refAddr, "in", "network");
      }
    }
  }

  // 2. Glue resources that connect two included AWS resources!
  for (const glue of glueBlocks) {
    const includedRefs = glue.refs.filter((r) => allResources.has(r));
    if (includedRefs.length < 2) continue;

    if (
      glue.type === "aws_api_gateway_integration" ||
      glue.type === "aws_apigatewayv2_integration"
    ) {
      const apiRef = includedRefs.find((r) => allResources.get(r).kind === "apigw");
      const targetRef = includedRefs.find((r) => r !== apiRef);
      if (apiRef && targetRef) addEdge(apiRef, targetRef, "Invoke", "flow");
    } else if (glue.type === "aws_lambda_event_source_mapping") {
      const lambdaRef = includedRefs.find((r) => allResources.get(r).kind === "lambda");
      const sourceRef = includedRefs.find((r) => r !== lambdaRef);
      if (sourceRef && lambdaRef) addEdge(sourceRef, lambdaRef, "Trigger / Poll", "async");
    } else if (glue.type === "aws_s3_bucket_notification") {
      const s3Ref = includedRefs.find((r) => allResources.get(r).kind === "s3");
      for (const r of includedRefs) {
        if (r !== s3Ref && s3Ref) addEdge(s3Ref, r, "S3 Event", "async");
      }
    } else if (glue.type === "aws_sns_topic_subscription") {
      const snsRef = includedRefs.find((r) => allResources.get(r).kind === "sns");
      for (const r of includedRefs) {
        if (r !== snsRef && snsRef) addEdge(snsRef, r, "Subscribe", "async");
      }
    } else if (glue.type === "aws_cloudwatch_event_target") {
      const ruleRef = includedRefs.find((r) => allResources.get(r).kind === "eventbridge");
      for (const r of includedRefs) {
        if (r !== ruleRef && ruleRef) addEdge(ruleRef, r, "Target", "async");
      }
    } else if (glue.type === "aws_lb_listener" || glue.type === "aws_lb_target_group") {
      const lbRef = includedRefs.find((r) => allResources.get(r).kind === "alb");
      for (const r of includedRefs) {
        if (r !== lbRef && lbRef) addEdge(lbRef, r, "Forward", "flow");
      }
    }
  }

  const nodes = [...allResources.values()].map(
    ({ body: _body, refs: _refs, ...cleanNode }) => cleanNode
  );

  const projectName = path.basename(path.resolve(tfDir));
  const includedOptional = [...includeSet].filter((c) => c !== "default");

  return {
    title: title || `AWS アーキテクチャ構成図 (${projectName})`,
    subtitle:
      subtitle ||
      `Terraform (.tf) 自動解析 — 実処理・データ層抽出${
        includedOptional.length > 0 ? ` (+${includedOptional.join(", ")})` : " (SecurityGroup / IAM / ネットワーク補助は省略)"
      }`,
    sourceDir: path.resolve(tfDir),
    scannedFiles: tfFiles.length,
    includedOptionalCategories: includedOptional,
    omittedSummary,
    nodes,
    edges: [...edgeMap.values()],
  };
}

const HELP_TEXT = `
scan-terraform.mjs - Terraform (.tf) AWS Architecture Resource Scanner

Usage:
  node scripts/scan-terraform.mjs --tf-dir <dir> [-o arch.json] [options]

Options:
  -d, --tf-dir <path>       Directory containing Terraform .tf files (default: .)
  -o, --output <path>       Write extracted JSON spec to file (default: stdout)
      --include <list>      Comma-separated optional categories to include:
                            security, network, iam, observability, all
      --title <text>        Custom diagram title
      --subtitle <text>     Custom diagram subtitle
  -h, --help                Show help
`.trim();

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      "tf-dir": { type: "string", short: "d" },
      output: { type: "string", short: "o" },
      include: { type: "string", default: "" },
      title: { type: "string" },
      subtitle: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const tfDir = values["tf-dir"] || positionals[0] || ".";
  const includeCategories = values.include
    ? values.include.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const spec = await scanTerraformDirectory(tfDir, {
    includeCategories,
    title: values.title,
    subtitle: values.subtitle,
  });

  const jsonStr = JSON.stringify(spec, null, 2);
  if (values.output) {
    await fs.mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
    await fs.writeFile(values.output, jsonStr, "utf8");
    console.error(
      `Scanned ${spec.scannedFiles} .tf files -> ${spec.nodes.length} nodes, ${spec.edges.length} edges -> ${values.output}`
    );
  } else {
    process.stdout.write(jsonStr + "\n");
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(fsSync.realpathSync(process.argv[1])).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error("Error:", err.message || err);
    process.exit(1);
  });
}

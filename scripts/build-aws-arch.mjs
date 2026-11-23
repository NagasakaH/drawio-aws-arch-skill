#!/usr/bin/env node
/**
 * build-aws-arch.mjs
 * Generates a clean AWS Architecture Diagram (.drawio XML + .drawio.png)
 * from either a Terraform directory (`--tf-dir`) or a curated JSON spec (`--spec`).
 * Uses official AWS4 icons (`mxgraph.aws4.*`) and embeds the draw.io XML into the PNG.
 */
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { convertXmlToPng, convertXmlToSvg } from "./drawio2png.mjs";
import { scanTerraformDirectory } from "./scan-terraform.mjs";

function escapeXml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LAYER_CONFIG = [
  {
    id: "edge",
    title: "Edge / API / Trigger",
    subtitle: "CloudFront・API GW・ALB・EventBridge",
    fillColor: "#F6F0FF",
    strokeColor: "#8C4FFF",
  },
  {
    id: "compute",
    title: "Compute & Orchestration",
    subtitle: "Lambda・Step Functions・ECS・EKS・EC2",
    fillColor: "#FFF7EE",
    strokeColor: "#ED7100",
  },
  {
    id: "messaging",
    title: "Messaging / Events",
    subtitle: "SQS・SNS・Kinesis",
    fillColor: "#FFF0F6",
    strokeColor: "#E7157B",
  },
  {
    id: "storage",
    title: "Data & Storage",
    subtitle: "Aurora / RDS・DynamoDB・S3・ElastiCache",
    fillColor: "#F0F8F2",
    strokeColor: "#248814",
  },
  {
    id: "security",
    title: "Security (Optional)",
    subtitle: "Security Group・WAF・KMS・Secrets",
    fillColor: "#FFF2F3",
    strokeColor: "#DD344C",
  },
  {
    id: "network",
    title: "Network (Optional)",
    subtitle: "VPC・Subnet・NAT・VPCE",
    fillColor: "#F2F8F0",
    strokeColor: "#248814",
  },
  {
    id: "iam",
    title: "IAM (Optional)",
    subtitle: "IAM Role・Policy",
    fillColor: "#FFF5F5",
    strokeColor: "#DD344C",
  },
  {
    id: "observability",
    title: "Observability (Optional)",
    subtitle: "CloudWatch Logs・Alarms",
    fillColor: "#FDF2F8",
    strokeColor: "#E7157B",
  },
];

const AWS_KIND_STYLES = {
  // Edge
  cloudfront: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudfront;fillColor=#8C4FFF;strokeColor=#ffffff;",
  },
  apigw: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;fillColor=#E7157B;strokeColor=#ffffff;",
  },
  alb: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.application_load_balancer;fillColor=#8C4FFF;strokeColor=#ffffff;",
  },
  cognito: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cognito;fillColor=#DD344C;strokeColor=#ffffff;",
  },
  eventbridge: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.eventbridge;fillColor=#E7157B;strokeColor=#ffffff;",
  },

  // Compute & Orchestration
  lambda: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#ED7100;strokeColor=#ffffff;",
  },
  sfn: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.step_functions;fillColor=#E7157B;strokeColor=#ffffff;",
  },
  ecs: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ecs;fillColor=#ED7100;strokeColor=#ffffff;",
  },
  eks: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.eks;fillColor=#ED7100;strokeColor=#ffffff;",
  },
  ec2: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2;fillColor=#ED7100;strokeColor=#ffffff;",
  },

  // Messaging
  sqs: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sqs;fillColor=#E7157B;strokeColor=#ffffff;",
  },
  sns: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sns;fillColor=#E7157B;strokeColor=#ffffff;",
  },
  kinesis: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.kinesis;fillColor=#8C4FFF;strokeColor=#ffffff;",
  },
  firehose: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.kinesis_data_firehose;fillColor=#8C4FFF;strokeColor=#ffffff;",
  },

  // Storage & Database
  aurora: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.aurora;fillColor=#3B48CC;strokeColor=#ffffff;",
  },
  rds: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.rds;fillColor=#3B48CC;strokeColor=#ffffff;",
  },
  dynamodb: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;fillColor=#3B48CC;strokeColor=#ffffff;",
  },
  s3: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;fillColor=#3F8624;strokeColor=#ffffff;",
  },
  elasticache: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.elasticache;fillColor=#3B48CC;strokeColor=#ffffff;",
  },
  efs: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.efs_standard;fillColor=#3F8624;strokeColor=#ffffff;",
  },
  opensearch: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.opensearch_service_data_node;fillColor=#8C4FFF;strokeColor=#ffffff;",
  },

  // Optional: Security / Network / IAM / Observability
  sg: {
    width: 155,
    height: 54,
    isIcon: false,
    style:
      "rounded=1;whiteSpace=wrap;html=1;dashed=1;dashPattern=6 3;fillColor=#fff0f0;strokeColor=#DD344C;strokeWidth=1.8;",
  },
  waf: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.waf;fillColor=#DD344C;strokeColor=#ffffff;",
  },
  kms: {
    width: 155,
    height: 54,
    isIcon: false,
    style:
      "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff0f0;strokeColor=#DD344C;",
  },
  secrets: {
    width: 155,
    height: 54,
    isIcon: false,
    style:
      "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff0f0;strokeColor=#DD344C;",
  },
  vpc: {
    width: 155,
    height: 54,
    isIcon: false,
    style:
      "rounded=1;whiteSpace=wrap;html=1;fillColor=#E9F3E6;strokeColor=#248814;strokeWidth=1.8;",
  },
  subnet: {
    width: 155,
    height: 50,
    isIcon: false,
    style:
      "rounded=1;whiteSpace=wrap;html=1;dashed=1;fillColor=#f2f8ff;strokeColor=#007DBC;",
  },
  nat: {
    width: 155,
    height: 50,
    isIcon: false,
    style:
      "rounded=1;whiteSpace=wrap;html=1;fillColor=#f6f0ff;strokeColor=#8C4FFF;",
  },
  igw: {
    width: 155,
    height: 50,
    isIcon: false,
    style:
      "rounded=1;whiteSpace=wrap;html=1;fillColor=#f6f0ff;strokeColor=#8C4FFF;",
  },
  vpce: {
    width: 155,
    height: 50,
    isIcon: false,
    style:
      "rounded=1;whiteSpace=wrap;html=1;fillColor=#f6f0ff;strokeColor=#8C4FFF;",
  },
  iam: {
    width: 155,
    height: 50,
    isIcon: false,
    style:
      "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff5f5;strokeColor=#DD344C;",
  },
  cloudwatch: {
    width: 155,
    height: 50,
    isIcon: false,
    style:
      "rounded=1;whiteSpace=wrap;html=1;fillColor=#fdf2f8;strokeColor=#E7157B;",
  },
};

const EDGE_STYLES = {
  flow: "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;strokeWidth=2;strokeColor=#232F3E;",
  data: "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeWidth=2;strokeColor=#3B48CC;",
  async:
    "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;dashed=1;dashPattern=6 4;html=1;endArrow=classic;strokeWidth=2;strokeColor=#E7157B;",
  security:
    "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;dashed=1;html=1;endArrow=open;strokeWidth=1.4;strokeColor=#DD344C;",
  network:
    "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;dashed=1;html=1;endArrow=open;strokeWidth=1.4;strokeColor=#248814;",
};

function formatResourceLabel(node) {
  const lines = [`<b>${escapeXml(node.label || node.tfName || node.id)}</b>`];
  if (node.serviceLabel && !String(node.label || "").toLowerCase().includes(node.serviceLabel.toLowerCase())) {
    lines.push(`<font color="#555555" style="font-size:10px">${escapeXml(node.serviceLabel)}</font>`);
  }
  if (node.subtitle) {
    lines.push(`<font color="#666666" style="font-size:10px">${escapeXml(node.subtitle)}</font>`);
  }
  return lines.join("<br>");
}

/**
 * Generates AWS Architecture draw.io `<mxfile>` XML from an architecture specification.
 */
export function generateAwsArchDrawioXml(spec) {
  const title = spec.title || "AWS アーキテクチャ構成図";
  const subtitle = spec.subtitle || "Terraform リソース構成 (実処理・データ層)";
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const edges = Array.isArray(spec.edges) ? spec.edges : [];

  // Group nodes by active layer
  const activeLayers = [];
  for (const cfg of LAYER_CONFIG) {
    const layerNodes = nodes.filter((n) => n.layer === cfg.id);
    if (layerNodes.length > 0) {
      activeLayers.push({ ...cfg, nodes: layerNodes });
    }
  }
  // Fallback for any custom layer
  const knownIds = new Set(LAYER_CONFIG.map((c) => c.id));
  const extraNodes = nodes.filter((n) => !knownIds.has(n.layer));
  if (extraNodes.length > 0) {
    activeLayers.push({
      id: "other",
      title: "Other AWS Resources",
      subtitle: "",
      fillColor: "#f5f5f5",
      strokeColor: "#666666",
      nodes: extraNodes,
    });
  }

  const outerPadX = 35;
  const outerPadY = 25;
  const titleBannerH = 56;
  const awsCloudTopY = outerPadY + titleBannerH + 16;
  const awsCloudPadX = 28;
  const awsCloudHeaderH = 44;
  const awsCloudPadBottom = 26;
  const layerGapX = 48;
  const layerWidth = 235;
  const layerHeaderH = 48;
  const nodeVerticalPitch = 138;

  // Determine uniform height for all layer columns inside AWS Cloud
  let maxLayerNodes = 1;
  for (const l of activeLayers) {
    if (l.nodes.length > maxLayerNodes) maxLayerNodes = l.nodes.length;
  }
  const layerHeight = Math.max(210, layerHeaderH + 26 + maxLayerNodes * nodeVerticalPitch);
  const awsCloudWidth =
    awsCloudPadX * 2 +
    activeLayers.length * layerWidth +
    Math.max(0, activeLayers.length - 1) * layerGapX;
  const awsCloudHeight = awsCloudHeaderH + layerHeight + awsCloudPadBottom;

  const nodeLayoutMap = new Map();

  // Compute coordinates
  activeLayers.forEach((layer, lIdx) => {
    layer.relX = awsCloudPadX + lIdx * (layerWidth + layerGapX);
    layer.relY = awsCloudHeaderH;
    layer.absX = outerPadX + layer.relX;
    layer.absY = awsCloudTopY + layer.relY;
    layer.index = lIdx;

    const availH = layerHeight - layerHeaderH - 20;
    const pitch = Math.min(nodeVerticalPitch, Math.floor(availH / Math.max(1, layer.nodes.length)));
    const totalUsedH = layer.nodes.length * pitch;
    const startY = layerHeaderH + 16 + Math.max(0, Math.floor((availH - totalUsedH) / 2));

    layer.nodes.forEach((n, nIdx) => {
      const preset = AWS_KIND_STYLES[n.kind] || AWS_KIND_STYLES.lambda;
      const w = Number(n.width || preset.width);
      const h = Number(n.height || preset.height);
      const relX = Math.round((layerWidth - w) / 2);
      const relY = startY + nIdx * pitch;

      nodeLayoutMap.set(n.id, {
        node: n,
        preset,
        layer,
        nIdx,
        relX,
        relY,
        absX: layer.absX + relX,
        absY: layer.absY + relY,
        width: w,
        height: h,
        centerX: layer.absX + relX + w / 2,
        centerY: layer.absY + relY + h / 2,
      });
    });
  });

  // Footer summary of omitted categories (e.g. Security Groups / IAM) so the reader knows what was filtered
  const omittedEntries = Object.entries(spec.omittedSummary || {});
  const omittedCount = omittedEntries.reduce((sum, [, c]) => sum + c, 0);
  const footerText =
    omittedCount > 0
      ? `省略された補助リソース (${omittedCount}件): ${omittedEntries
          .slice(0, 8)
          .map(([t, c]) => `${t}×${c}`)
          .join(", ")}${omittedEntries.length > 8 ? " ..." : ""}  (必要時は --include security,network,iam で表示)`
      : null;

  const xmlLines = [];
  xmlLines.push(`<mxfile host="drawio-aws-arch-skill" version="1.0.0">`);
  xmlLines.push(`  <diagram id="aws-arch-1" name="${escapeXml(title)}">`);
  xmlLines.push(
    `    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1200" shadow="0">`
  );
  xmlLines.push(`      <root>`);
  xmlLines.push(`        <mxCell id="0" />`);
  xmlLines.push(`        <mxCell id="1" parent="0" />`);

  // 1. Title Banner
  const titleHtml = `<b style="font-size:17px">${escapeXml(title)}</b><br><font color="#555555">${escapeXml(subtitle)}</font>`;
  xmlLines.push(
    `        <mxCell id="title_banner" value="${escapeXml(titleHtml)}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;arcSize=14;" vertex="1" parent="1">`
  );
  xmlLines.push(
    `          <mxGeometry x="${outerPadX}" y="${outerPadY}" width="${awsCloudWidth}" height="${titleBannerH}" as="geometry" />`
  );
  xmlLines.push(`        </mxCell>`);

  // 2. Outer AWS Cloud Container
  xmlLines.push(
    `        <mxCell id="aws_cloud" value="AWS Cloud" style="points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=14;fontStyle=1;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_aws_cloud_alt;strokeColor=#232F3E;fillColor=#FAFAFA;verticalAlign=top;align=left;spacingLeft=34;strokeWidth=2;" vertex="1" parent="1">`
  );
  xmlLines.push(
    `          <mxGeometry x="${outerPadX}" y="${awsCloudTopY}" width="${awsCloudWidth}" height="${awsCloudHeight}" as="geometry" />`
  );
  xmlLines.push(`        </mxCell>`);

  // 3. Layer Swimlane Boxes inside AWS Cloud
  for (const layer of activeLayers) {
    const layerId = `layer_${layer.id}`;
    const hdrHtml = `<b style="font-size:12px">${escapeXml(layer.title)}</b>${
      layer.subtitle
        ? `<br><font color="#555555" style="font-size:10px">${escapeXml(layer.subtitle)}</font>`
        : ""
    }`;
    const layerStyle = `swimlane;horizontal=1;startSize=${layerHeaderH};rounded=1;fillColor=${layer.fillColor};strokeColor=${layer.strokeColor};swimlaneFillColor=#ffffff;strokeWidth=1.5;html=1;whiteSpace=wrap;shadow=1;`;
    xmlLines.push(
      `        <mxCell id="${layerId}" value="${escapeXml(hdrHtml)}" style="${layerStyle}" vertex="1" parent="aws_cloud">`
    );
    xmlLines.push(
      `          <mxGeometry x="${layer.relX}" y="${layer.relY}" width="${layerWidth}" height="${layerHeight}" as="geometry" />`
    );
    xmlLines.push(`        </mxCell>`);

    // Nodes inside this layer
    for (const n of layer.nodes) {
      const layout = nodeLayoutMap.get(n.id);
      const labelHtml = formatResourceLabel(n);
      const style = n.style || layout.preset.style;
      xmlLines.push(
        `        <mxCell id="${escapeXml(n.id)}" value="${escapeXml(labelHtml)}" style="${escapeXml(style)}" vertex="1" parent="${layerId}">`
      );
      xmlLines.push(
        `          <mxGeometry x="${layout.relX}" y="${layout.relY}" width="${layout.width}" height="${layout.height}" as="geometry" />`
      );
      xmlLines.push(`        </mxCell>`);
    }
  }

  // 4. Edges between AWS Resources
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const src = nodeLayoutMap.get(e.from || e.source);
    const trg = nodeLayoutMap.get(e.to || e.target);
    if (!src || !trg) continue;

    const edgeId = e.id || `edge_${i + 1}`;
    const baseStyle = e.style || EDGE_STYLES[e.type || "flow"] || EDGE_STYLES.flow;
    let portStyle = "";
    const waypoints = Array.isArray(e.waypoints) ? [...e.waypoints] : [];

    const dLayer = trg.layer.index - src.layer.index;
    const dIdx = trg.nIdx - src.nIdx;

    if (dLayer > 0) {
      portStyle = "exitX=1;exitY=0.5;entryX=0;entryY=0.5;";
      if (dLayer > 1 && waypoints.length === 0) {
        // Check if an intermediate layer has a node blocking the horizontal line at trg.centerY
        let blocked = false;
        for (let midIdx = src.layer.index + 1; midIdx < trg.layer.index; midIdx++) {
          const midLayer = activeLayers[midIdx];
          for (const mn of midLayer.nodes) {
            const ml = nodeLayoutMap.get(mn.id);
            if (ml && Math.abs(ml.centerY - trg.centerY) < 55) {
              blocked = true;
              break;
            }
          }
        }
        const midX1 = Math.round(src.layer.absX + layerWidth + layerGapX * 0.45);
        const midX2 = Math.round(trg.layer.absX - layerGapX * 0.45);
        if (blocked) {
          const detourY = Math.round(trg.centerY - 58);
          waypoints.push(
            { x: midX1, y: Math.round(src.centerY) },
            { x: midX1, y: detourY },
            { x: midX2, y: detourY },
            { x: midX2, y: Math.round(trg.centerY) }
          );
        } else {
          waypoints.push(
            { x: midX1, y: Math.round(src.centerY) },
            { x: midX1, y: Math.round(trg.centerY) }
          );
        }
      }
    } else if (dLayer < 0) {
      portStyle = "exitX=0;exitY=0.5;entryX=1;entryY=0.5;";
    } else if (dIdx > 0) {
      const labelDy = src.node.subtitle ? 52 : 38;
      const exitBot = src.preset.isIcon
        ? `exitX=0.5;exitY=1;exitDx=0;exitDy=${labelDy};exitPerimeter=0;`
        : "exitX=0.5;exitY=1;";
      portStyle = `${exitBot}entryX=0.5;entryY=0;`;
    } else {
      const labelDy = trg.node.subtitle ? 52 : 38;
      const entryBot = trg.preset.isIcon
        ? `entryX=0.5;entryY=1;entryDx=0;entryDy=${labelDy};entryPerimeter=0;`
        : "entryX=0.5;entryY=1;";
      portStyle = `exitX=0.5;exitY=0;${entryBot}`;
    }

    xmlLines.push(
      `        <mxCell id="${escapeXml(edgeId)}" value="${escapeXml(e.label || "")}" style="${escapeXml(baseStyle + portStyle)}" edge="1" parent="1" source="${escapeXml(src.node.id)}" target="${escapeXml(trg.node.id)}">`
    );
    if (waypoints.length > 0) {
      xmlLines.push(`          <mxGeometry relative="1" as="geometry">`);
      xmlLines.push(`            <Array as="points">`);
      for (const wp of waypoints) {
        xmlLines.push(`              <mxPoint x="${wp.x}" y="${wp.y}" />`);
      }
      xmlLines.push(`            </Array>`);
      xmlLines.push(`          </mxGeometry>`);
    } else {
      xmlLines.push(`          <mxGeometry relative="1" as="geometry" />`);
    }
    xmlLines.push(`        </mxCell>`);
  }

  // 5. Optional Omitted-Resources Footer Note
  if (footerText) {
    const footerY = awsCloudTopY + awsCloudHeight + 12;
    xmlLines.push(
      `        <mxCell id="omitted_footer" value="${escapeXml(footerText)}" style="text;html=1;align=left;verticalAlign=middle;fontSize=11;fontColor=#666666;" vertex="1" parent="1">`
    );
    xmlLines.push(
      `          <mxGeometry x="${outerPadX}" y="${footerY}" width="${awsCloudWidth}" height="24" as="geometry" />`
    );
    xmlLines.push(`        </mxCell>`);
  }

  xmlLines.push(`      </root>`);
  xmlLines.push(`    </mxGraphModel>`);
  xmlLines.push(`  </diagram>`);
  xmlLines.push(`</mxfile>`);

  return xmlLines.join("\n");
}

const HELP_TEXT = `
build-aws-arch.mjs - Terraform -> AWS Architecture Diagram (.drawio + .drawio.png) Generator

Usage:
  node scripts/build-aws-arch.mjs --tf-dir <terraform-dir> [-o aws-arch.drawio.png] [options]
  node scripts/build-aws-arch.mjs --spec <arch.json> [-o aws-arch.drawio.png] [options]

Options:
  -d, --tf-dir <path>       Directory containing Terraform .tf files
  -i, --spec <path>         Pre-extracted / curated architecture JSON spec
  -o, --output <path>       Output PNG or SVG file path (default: aws-arch.drawio.png)
      --xml-out <path>      Output .drawio XML file path
      --json-out <path>     Save extracted JSON spec when using --tf-dir
      --include <list>      Optional categories to include (comma-separated):
                            security, network, iam, observability, all
      --title <text>        Custom diagram title
      --subtitle <text>     Custom diagram subtitle
  -s, --scale <number>      PNG scale factor (default: 2)
  -b, --border <px>         Border padding in pixels (default: 16)
      --theme <theme>       Color theme: light | dark (default: light)
  -h, --help                Show help
`.trim();

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      "tf-dir": { type: "string", short: "d" },
      spec: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
      "xml-out": { type: "string" },
      "json-out": { type: "string" },
      include: { type: "string", default: "" },
      title: { type: "string" },
      subtitle: { type: "string" },
      scale: { type: "string", short: "s", default: "2" },
      border: { type: "string", short: "b", default: "16" },
      theme: { type: "string", default: "light" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help || (!values["tf-dir"] && !values.spec && positionals.length === 0)) {
    console.log(HELP_TEXT);
    process.exit(values.help ? 0 : 1);
  }

  let spec;
  if (values.spec) {
    spec = JSON.parse(await fs.readFile(values.spec, "utf8"));
    if (values.title) spec.title = values.title;
    if (values.subtitle) spec.subtitle = values.subtitle;
  } else {
    const tfDir = values["tf-dir"] || positionals[0];
    const includeCategories = values.include
      ? values.include.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    spec = await scanTerraformDirectory(tfDir, {
      includeCategories,
      title: values.title,
      subtitle: values.subtitle,
    });
    if (values["json-out"]) {
      await fs.mkdir(path.dirname(path.resolve(values["json-out"])), { recursive: true });
      await fs.writeFile(values["json-out"], JSON.stringify(spec, null, 2), "utf8");
      console.log(`Generated JSON: ${values["json-out"]}`);
    }
  }

  const xml = generateAwsArchDrawioXml(spec);
  const outPath = values.output || "aws-arch.drawio.png";
  const xmlOutPath =
    values["xml-out"] ||
    outPath.replace(/\.drawio\.png$|\.png$|\.svg$/i, "") + ".drawio";

  await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await fs.mkdir(path.dirname(path.resolve(xmlOutPath)), { recursive: true });
  await fs.writeFile(xmlOutPath, xml, "utf8");

  const scale = parseFloat(values.scale) || 2;
  const border = parseInt(values.border, 10) || 16;

  if (outPath.toLowerCase().endsWith(".svg")) {
    const res = convertXmlToSvg(xml, {
      scale: 1,
      border,
      theme: values.theme,
      embedXml: true,
    });
    await fs.writeFile(outPath, res.svg, "utf8");
    console.log(`Generated XML: ${xmlOutPath}`);
    console.log(`Generated SVG: ${outPath} (${res.width}x${res.height}px)`);
  } else {
    const res = convertXmlToPng(xml, {
      scale,
      border,
      theme: values.theme,
      embedXml: true,
      dpi: 144,
    });
    await fs.writeFile(outPath, res.png);
    console.log(`Generated XML: ${xmlOutPath}`);
    console.log(`Generated PNG: ${outPath} (${res.width}x${res.height}px)`);
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

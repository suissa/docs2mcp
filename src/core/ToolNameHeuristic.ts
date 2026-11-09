import type { RawOperation } from "../types.js";

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export class ToolNameHeuristic {
  derive(sourceName: string, operation: RawOperation): string {
    const owner = operation.owner?.toLowerCase() ?? "client";
    const method = operation.sourceMethod.replace(/\(\)$/, "").toLowerCase();
    let action: string;

    if (method === "search") action = "search_videos";
    else if (owner === "video" && method === "download") action = "download_video";
    else if (owner === "channel" && method === "videos") action = "get_channel_videos";
    else if (owner === "pornstar" && method === "videos") action = "get_pornstar_videos";
    else if (owner === "client" && method.startsWith("get_")) action = method;
    else if (owner === "account" && method.startsWith("get_")) action = method;
    else if (method === "worked_for_with") action = "get_" + owner + "_related_channels";
    else if (method === "get_author") action = "get_video_author";
    else if (method === "get_pornstars") action = "get_video_pornstars";
    else if (method.startsWith("get_")) action = method;
    else action = slug(operation.title);

    const prefix = slug(sourceName) || "docs";
    return (prefix + "_" + action).slice(0, 64);
  }

  aliases(operation: RawOperation, toolName: string): string[] {
    const values = [
      toolName,
      operation.sourceMethod,
      operation.sourceMethod.replace(/\(\)$/, ""),
      operation.id.replace(/-/g, "_"),
      slug(operation.title),
      [operation.owner, operation.sourceMethod.replace(/\(\)$/, "")].filter(Boolean).join(".")
    ];
    return [...new Set(values.map((value) => value.toLowerCase()).filter(Boolean))];
  }
}
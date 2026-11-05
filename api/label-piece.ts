import { handleLabelRequest } from "../server/labelPiece.js";

export function POST(request: Request): Promise<Response> {
  return handleLabelRequest(request, { env: process.env });
}

import { handleInspirationRequest } from "../server/readInspiration.js";

export function POST(request: Request): Promise<Response> {
  return handleInspirationRequest(request, { env: process.env });
}

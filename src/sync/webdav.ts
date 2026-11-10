import { checkSize, emptyDocument, encodeDocument, parseDocument, type SyncDocument } from "./model.ts";

export interface HttpResponse { status: number; text: string; etag?: string }
export type Request = (method: string, url: string, headers: Record<string, string>, body?: string) => Promise<HttpResponse>;

export function syncURLs(base: string): { directory: string; file: string } {
  const u = new URL(base.trim());
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error("Use a WebDAV folder URL without credentials, query or fragment.");
  u.pathname = u.pathname.replace(/\/*$/, "/") + "zotero-agent-chat/";
  return { directory: u.href, file: new URL("v1.json", u).href };
}

export class WebDAV {
  private request: Request;
  private urls: { directory: string; file: string };
  constructor(base: string, request: Request) { this.urls = syncURLs(base); this.request = request; }
  async read(): Promise<{ doc: SyncDocument; etag?: string }> {
    const r = await this.request("GET", this.urls.file, { "Cache-Control": "no-cache" });
    if (r.status === 404) return { doc: emptyDocument() };
    this.check(r, [200]);
    if (!r.etag || r.etag.startsWith("W/") || !/^"[^"\r\n]+"$/.test(r.etag)) throw Error("WebDAV must provide a strong ETag for safe chat sync.");
    return { doc: parseDocument(r.text), etag: r.etag };
  }
  async write(doc: SyncDocument, etag?: string): Promise<boolean> {
    const body = encodeDocument(doc);
    checkSize(body);
    const headers = { "Content-Type": "application/json; charset=utf-8", ...(etag ? { "If-Match": etag } : { "If-None-Match": "*" }) };
    // Some servers close the connection before reading a large PUT to a missing
    // parent, so no usable 409 reaches Gecko. Create our collection first.
    if (!etag) {
      this.check(await this.request("MKCOL", this.urls.directory, {}), [201, 405]);
    }
    const r = await this.request("PUT", this.urls.file, headers, body);
    if ([409, 412].includes(r.status)) return false;
    this.check(r, [200, 201, 204]);
    return true;
  }
  private check(r: HttpResponse, accepted: number[]): void {
    if (accepted.includes(r.status)) return;
    if (r.status === 0) throw Error("WebDAV connection failed. Local chats are waiting to sync.");
    if (r.status === 401) throw Error("WebDAV sign-in failed. Check the username and password.");
    if (r.status === 403) throw Error("WebDAV denied access to chat storage. Check folder permissions.");
    throw Error(`WebDAV HTTP ${r.status}. Local chats were kept.`);
  }
}

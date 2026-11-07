/** Read packaged text through a Gecko channel, including jar: XPI URLs with '@'.
 * Zotero.HTTP.request treats those URLs as HTTP authorities and reads
 * nsIURI.username, which throws before any native helper can be extracted.
 */
export function readPackagedText(rootURI: string, relativePath: string): Promise<string> {
  const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
  const channel = NetUtil.newChannel({
    uri: rootURI + relativePath,
    loadUsingSystemPrincipal: true,
    securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
    contentPolicyType: Ci.nsIContentPolicy.TYPE_OTHER,
  });
  return Zotero.File.getContentsAsync(channel, "UTF-8");
}

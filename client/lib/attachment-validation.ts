// Mirrors server/src/routes/messages.ts's isExtensionAllowed() — fail-fast UX
// only, not a security boundary. The server re-checks on presign regardless.
const DEFAULT_BLACKLIST_EXTENSIONS =
  "exe,msi,bat,cmd,com,scr,pif,vbs,vbe,js,jse,wsf,wsh,ps1,ps1xml,psc1,sh,bash,zsh,csh,ksh,run,app,apk,ipa,dmg,pkg,dll,so,dylib,sys,drv,jar,deb,rpm";

function isSingleExtensionAllowed(fileName: string): boolean {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  const whitelist = process.env.NEXT_PUBLIC_ATTACHMENT_WHITELIST_EXTENSIONS;
  if (whitelist) {
    const allowed = whitelist.split(",").map((e) => e.trim().toLowerCase());
    return allowed.includes(extension);
  }

  const blacklist = process.env.NEXT_PUBLIC_ATTACHMENT_BLACKLIST_EXTENSIONS ?? DEFAULT_BLACKLIST_EXTENSIONS;
  const blocked = blacklist
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return !blocked.includes(extension);
}

export function isExtensionAllowed(fileName: string | string[]): boolean {
  const fileNames = Array.isArray(fileName) ? fileName : [fileName];
  return fileNames.some(isSingleExtensionAllowed);
}

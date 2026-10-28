// Logo handling shared by every page. The server bumps `state.logo` whenever the logo is
// uploaded or reset, so open pages (and OBS) pick up the new image without a reload.

let current = null;

export function logoUrl(version) {
  return version ? `/api/logo?v=${version}` : "/api/logo";
}

export function applyLogo(version, wheel) {
  const url = logoUrl(version);
  if (url === current) return;
  current = url;
  document.documentElement.style.setProperty("--k-logo", `url("${url}")`);
  let icon = document.querySelector('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement("link");
    icon.rel = "icon";
    document.head.append(icon);
  }
  icon.href = url;
  wheel?.setLogo(url);
}

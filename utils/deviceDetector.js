'use strict';

/**
 * Parses user-agent strings and combines client-provided device/monitor info
 * to accurately identify device, monitor/display, browser, and OS.
 */
function parseDeviceDetails(userAgent = '', clientInfo = {}) {
  const ua = userAgent || '';
  let os = 'Unknown OS';
  let deviceType = 'desktop'; // desktop, mobile, tablet
  let deviceName = 'Desktop PC';
  let browser = 'Unknown Browser';

  // ── OS Detection ──────────────────────────────────────────
  if (/windows phone/i.test(ua)) {
    os = 'Windows Phone';
    deviceType = 'mobile';
    deviceName = 'Windows Phone';
  } else if (/windows nt 10\.0/i.test(ua)) {
    os = 'Windows 10/11';
    deviceName = 'Windows PC';
  } else if (/windows nt 6\.3/i.test(ua)) {
    os = 'Windows 8.1';
    deviceName = 'Windows PC';
  } else if (/windows nt 6\.2/i.test(ua)) {
    os = 'Windows 8';
    deviceName = 'Windows PC';
  } else if (/windows nt 6\.1/i.test(ua)) {
    os = 'Windows 7';
    deviceName = 'Windows PC';
  } else if (/ipad/i.test(ua)) {
    os = 'iPadOS';
    deviceType = 'tablet';
    deviceName = 'Apple iPad';
  } else if (/iphone/i.test(ua)) {
    os = 'iOS';
    deviceType = 'mobile';
    deviceName = 'Apple iPhone';
  } else if (/macintosh|mac os x/i.test(ua)) {
    os = 'macOS';
    deviceName = 'Apple Mac';
  } else if (/android/i.test(ua)) {
    os = 'Android';
    if (/tablet|sm-t|gt-p/i.test(ua)) {
      deviceType = 'tablet';
      deviceName = 'Android Tablet';
    } else {
      deviceType = 'mobile';
      deviceName = 'Android Phone';
    }
  } else if (/cros/i.test(ua)) {
    os = 'Chrome OS';
    deviceName = 'Chromebook';
  } else if (/linux/i.test(ua)) {
    os = 'Linux';
    deviceName = 'Linux Workstation';
  }

  // ── Browser Detection ──────────────────────────────────────
  const matchEdge = ua.match(/edg(?:e|a|ios)?\/([0-9.]+)/i);
  const matchChrome = ua.match(/(?:chrome|crios)\/([0-9.]+)/i);
  const matchFirefox = ua.match(/(?:firefox|fxios)\/([0-9.]+)/i);
  const matchSafari = ua.match(/version\/([0-9.]+).*safari/i);
  const matchOpera = ua.match(/(?:opera|opr)\/([0-9.]+)/i);
  const matchSamsung = ua.match(/samsungbrowser\/([0-9.]+)/i);

  if (matchEdge) {
    browser = `Microsoft Edge ${matchEdge[1].split('.')[0]}`;
  } else if (matchOpera) {
    browser = `Opera ${matchOpera[1].split('.')[0]}`;
  } else if (matchSamsung) {
    browser = `Samsung Internet ${matchSamsung[1].split('.')[0]}`;
  } else if (matchChrome && !/opr|edg/i.test(ua)) {
    browser = `Google Chrome ${matchChrome[1].split('.')[0]}`;
  } else if (matchFirefox) {
    browser = `Mozilla Firefox ${matchFirefox[1].split('.')[0]}`;
  } else if (matchSafari && !/chrome|crios/i.test(ua)) {
    browser = `Apple Safari ${matchSafari[1].split('.')[0]}`;
  }

  // Override with client-provided hardware/screen details if provided
  let screenResolution = clientInfo.screen_resolution || null;
  let colorDepth = clientInfo.color_depth ? `${clientInfo.color_depth}-bit` : null;
  let pixelRatio = clientInfo.pixel_ratio ? `${clientInfo.pixel_ratio}x` : null;

  if (clientInfo.screen_width && clientInfo.screen_height) {
    const w = parseInt(clientInfo.screen_width);
    const h = parseInt(clientInfo.screen_height);
    let label = '';
    if ((w >= 3840 && h >= 2160) || (w >= 2160 && h >= 3840)) label = ' (4K UHD)';
    else if ((w >= 2560 && h >= 1440) || (w >= 1440 && h >= 2560)) label = ' (2K QHD)';
    else if ((w >= 1920 && h >= 1080) || (w >= 1080 && h >= 1920)) label = ' (Full HD)';
    else if (w >= 1366 && h >= 768) label = ' (HD+)';
    else if (deviceType === 'mobile') label = ' (Mobile Display)';

    screenResolution = `${w} × ${h}${label}`;
  }

  if (clientInfo.device_type) {
    deviceType = clientInfo.device_type;
  }
  if (clientInfo.device_name) {
    deviceName = clientInfo.device_name;
  }

  return {
    deviceType,
    deviceName,
    os,
    browser,
    screenResolution,
    colorDepth,
    pixelRatio,
  };
}

module.exports = {
  parseDeviceDetails,
};

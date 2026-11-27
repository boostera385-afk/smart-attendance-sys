/**
 * EZVIZ Open Platform client (server only). Same account as EZVIZ Studio.
 * Token lives 7 days; cached per server instance. The API domain comes from the token (areaDomain).
 */
const BASE = process.env.EZVIZ_BASE_URL ?? "https://open.ezvizlife.com";

type Token = { accessToken: string; areaDomain: string; expireTime: number };
let cached: Token | null = null;

type EzResp<T> = { code: string; msg: string; data: T };

async function post<T>(url: string, fields: Record<string, string | number>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(Object.entries(fields).map(([k, v]) => [k, String(v)])),
    cache: "no-store",
  });
  const json = (await res.json()) as EzResp<T>;
  if (String(json.code) !== "200") throw new EzvizError(String(json.code), json.msg);
  return json.data;
}

export class EzvizError extends Error {
  constructor(
    public code: string,
    msg: string,
  ) {
    super(code === "60019" ? "Video encryption is on for this camera — turn it off in the EZVIZ app" : `EZVIZ ${code}: ${msg}`);
  }
}

export const ezvizConfigured = () => Boolean(process.env.EZVIZ_APP_KEY && process.env.EZVIZ_APP_SECRET);

async function token(): Promise<Token> {
  if (cached && cached.expireTime - Date.now() > 3600_000) return cached;
  if (!ezvizConfigured()) throw new Error("EZVIZ_APP_KEY / EZVIZ_APP_SECRET are not set on the server.");
  const t = await post<Token>(`${BASE}/api/lapp/token/get`, {
    appKey: process.env.EZVIZ_APP_KEY!,
    appSecret: process.env.EZVIZ_APP_SECRET!,
  });
  cached = { ...t, areaDomain: t.areaDomain || BASE };
  return cached;
}

async function call<T>(path: string, fields: Record<string, string | number> = {}): Promise<T> {
  const t = await token();
  try {
    return await post<T>(`${t.areaDomain}${path}`, { accessToken: t.accessToken, ...fields });
  } catch (e) {
    if (e instanceof EzvizError && (e.code === "10002" || e.code === "10001")) {
      cached = null; // expired/invalid token → retry once
      const t2 = await token();
      return post<T>(`${t2.areaDomain}${path}`, { accessToken: t2.accessToken, ...fields });
    }
    throw e;
  }
}

export type EzDevice = { deviceSerial: string; deviceName: string; model: string; status: number };
export type EzChannel = { deviceSerial: string; channelNo: number; channelName: string; status: number };

export async function listDevices() {
  const [devices, channels] = await Promise.all([
    call<EzDevice[]>("/api/lapp/device/list", { pageStart: 0, pageSize: 50 }),
    call<EzChannel[]>("/api/lapp/camera/list", { pageStart: 0, pageSize: 50 }).catch(() => [] as EzChannel[]),
  ]);
  return { devices: devices ?? [], channels: channels ?? [] };
}

/** Takes a fresh picture on the camera; returns a temporary image URL hosted by EZVIZ. */
export async function capture(serial: string, channel = 1): Promise<string> {
  const d = await call<{ picUrl: string }>("/api/lapp/device/capture", { deviceSerial: serial, channelNo: channel });
  return d.picUrl;
}

/** Checks that live video is available (fails with a clear message when encryption is on). */
export async function liveCheck(serial: string, channel = 1): Promise<void> {
  await call("/api/lapp/v2/live/address/get", { deviceSerial: serial, channelNo: channel, protocol: 2, quality: 1 });
}

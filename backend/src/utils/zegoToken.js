import crypto from "crypto";

function rndNum(a, b) {
  return Math.ceil((a + (b - a)) * Math.random());
}

function makeRandomIv() {
  const str = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 16; i += 1) {
    result += str.charAt(Math.floor(Math.random() * str.length));
  }
  return result;
}

function getAlgorithm(key) {
  switch (Buffer.from(key).length) {
    case 16:
      return "aes-128-cbc";
    case 24:
      return "aes-192-cbc";
    case 32:
      return "aes-256-cbc";
    default:
      throw new Error("Invalid Zego secret length");
  }
}

function aesEncrypt(plainText, key, iv) {
  const cipher = crypto.createCipheriv(getAlgorithm(key), key, iv);
  cipher.setAutoPadding(true);
  const encrypted = cipher.update(plainText);
  const final = cipher.final();
  return Buffer.concat([encrypted, final]);
}

/** ZEGOCLOUD Token04 — keep server secret on the backend only */
export function generateToken04(
  appId,
  userId,
  secret,
  effectiveTimeInSeconds = 3600,
  payload = "",
) {
  if (!appId || typeof appId !== "number") {
    throw new Error("ZEGO App ID invalid");
  }
  if (!userId || typeof userId !== "string") {
    throw new Error("userId invalid");
  }
  if (!secret || typeof secret !== "string" || secret.length !== 32) {
    throw new Error("ZEGO Server Secret must be a 32-byte string");
  }
  if (!effectiveTimeInSeconds || typeof effectiveTimeInSeconds !== "number") {
    throw new Error("effectiveTimeInSeconds invalid");
  }

  const createTime = Math.floor(Date.now() / 1000);
  const tokenInfo = {
    app_id: appId,
    user_id: userId,
    nonce: rndNum(-2147483648, 2147483647),
    ctime: createTime,
    expire: createTime + effectiveTimeInSeconds,
    payload: payload || "",
  };

  const plainText = JSON.stringify(tokenInfo);
  const iv = makeRandomIv();
  const encryptBuf = aesEncrypt(plainText, secret, iv);

  const b1 = Buffer.alloc(8);
  const b2 = Buffer.alloc(2);
  const b3 = Buffer.alloc(2);
  b1.writeBigInt64BE(BigInt(tokenInfo.expire), 0);
  b2.writeUInt16BE(iv.length, 0);
  b3.writeUInt16BE(encryptBuf.length, 0);

  const buf = Buffer.concat([b1, b2, Buffer.from(iv), b3, encryptBuf]);
  return `04${buf.toString("base64")}`;
}

export function getZegoConfig() {
  const appId = Number(
    process.env.ZEGO_APP_ID || process.env.NEXT_PUBLIC_ZEGO_APP_ID || 0,
  );
  const serverSecret =
    process.env.ZEGO_SERVER_SECRET ||
    process.env.NEXT_PUBLIC_ZEGO_SERVER_SECRET ||
    "";
  return { appId, serverSecret };
}

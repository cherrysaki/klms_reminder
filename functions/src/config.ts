import {defineSecret} from "firebase-functions/params";

export const lineChannelSecret = defineSecret("LINE_CHANNEL_SECRET");
export const lineChannelAccessToken = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
export const klmsEncryptionKey = defineSecret("KLMS_ENCRYPTION_KEY");

export const KLMS_BASE_URL = "https://klms.keio.jp";
export const REGION = "asia-northeast1";

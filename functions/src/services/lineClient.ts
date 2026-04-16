import * as line from "@line/bot-sdk";

let client: line.messagingApi.MessagingApiClient | null = null;

export function getLineClient(
  channelAccessToken: string
): line.messagingApi.MessagingApiClient {
  if (!client) {
    client = new line.messagingApi.MessagingApiClient({
      channelAccessToken,
    });
  }
  return client;
}

export function verifySignature(
  body: string,
  signature: string,
  channelSecret: string
): boolean {
  return line.validateSignature(body, channelSecret, signature);
}

export async function replyText(
  channelAccessToken: string,
  replyToken: string,
  text: string
): Promise<void> {
  const api = getLineClient(channelAccessToken);
  await api.replyMessage({
    replyToken,
    messages: [{type: "text", text}],
  });
}

export async function pushText(
  channelAccessToken: string,
  to: string,
  text: string
): Promise<void> {
  const api = getLineClient(channelAccessToken);
  await api.pushMessage({
    to,
    messages: [{type: "text", text}],
  });
}

export async function getProfile(
  channelAccessToken: string,
  userId: string
): Promise<line.messagingApi.UserProfileResponse> {
  const api = getLineClient(channelAccessToken);
  return api.getProfile(userId);
}
